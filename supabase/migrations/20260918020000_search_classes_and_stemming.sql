-- Workspace search reached only todos, ideas, and projects, and every stored
-- vector and every query used the 'simple' configuration. "book" therefore
-- never matched "books", and a course code, a class name, or a saved note's
-- filename matched nothing at all. This migration switches the workspace to
-- English stemming and puts Classes, class notes, and assignments in results.
--
-- Assignments are todos with a class (20260914000100_assignment_todos.sql), so
-- they are already searched as rows; what is new is that the course code is
-- indexed alongside the task text and that a result now says which kind it is.
--
-- A generated column's expression cannot be replaced in place, so each existing
-- search_vector is dropped and re-added. Dropping the column drops its GIN index
-- with it, so every index is recreated below under its original name and
-- predicate. Only derived data is rebuilt; no row content is read or written.
--
-- Classes and class notes are hard deleted (20260914000300_class_deletes.sql),
-- so neither branch has a deleted_at filter to apply.
--
-- Identifiers are not prose, so they are indexed literally as well as stemmed:
-- a course code can be an English stopword ('IT'), which stems to nothing, or a
-- word whose stem is not itself ('STUDIES' -> 'studi'). Class names and note
-- filenames are short and are usually the code again, so they get the same
-- treatment; only the long free-text fields are stemmed alone. The query side
-- needs the same escape, because websearch_to_tsquery drops stopwords too, so
-- search_records falls back to the literal configuration when English leaves it
-- with nothing to look for.
--
-- The agent API strips search_vector from every record it returns but hashes the
-- whole row for its opaque `version`, so an agent holding a version taken before
-- this migration sees one conflict on its next write and re-reads.
--
-- One statement keeps the vector, index, type, and function changes atomic even
-- when the Supabase CLI applies migration statements separately.
do $migration$
begin

alter table public.todos drop column search_vector;
alter table public.ideas drop column search_vector;
alter table public.projects drop column search_vector;

-- A task's own words rank above the course code it belongs to, so that
-- searching MATH3012 lists its assignments without burying a task that names it.
alter table public.todos add column search_vector tsvector generated always as (
  setweight(
    to_tsvector('english'::regconfig, coalesce(text, '')),
    'A'
  ) ||
  setweight(
    to_tsvector('english'::regconfig, coalesce(class_id, '')),
    'B'
  ) ||
  setweight(
    to_tsvector('simple'::regconfig, coalesce(class_id, '')),
    'B'
  )
) stored;

alter table public.ideas add column search_vector tsvector generated always as (
  setweight(
    to_tsvector('english'::regconfig, coalesce(title, '')),
    'A'
  ) ||
  setweight(
    to_tsvector('english'::regconfig, coalesce(body, '')),
    'B'
  )
) stored;

alter table public.projects add column search_vector tsvector generated always as (
  setweight(
    to_tsvector('english'::regconfig, coalesce(title, '')),
    'A'
  ) ||
  setweight(
    to_tsvector('english'::regconfig, coalesce(description, '')),
    'B'
  )
) stored;

-- A class carries its own name and the course code that is its primary key; an
-- imported class recovered without a name is still findable by that code.
alter table public.classes add column search_vector tsvector generated always as (
  setweight(
    to_tsvector('english'::regconfig, coalesce(name, '')),
    'A'
  ) ||
  setweight(
    to_tsvector('simple'::regconfig, coalesce(name, '')),
    'A'
  ) ||
  setweight(
    to_tsvector('english'::regconfig, id),
    'B'
  ) ||
  setweight(
    to_tsvector('simple'::regconfig, id),
    'B'
  )
) stored;

alter table public.class_notes add column search_vector tsvector generated always as (
  setweight(
    to_tsvector('english'::regconfig, name),
    'A'
  ) ||
  setweight(
    to_tsvector('simple'::regconfig, name),
    'A'
  ) ||
  setweight(
    to_tsvector('english'::regconfig, course_id),
    'B'
  ) ||
  setweight(
    to_tsvector('simple'::regconfig, course_id),
    'B'
  )
) stored;

create index todos_search_idx
  on public.todos using gin (search_vector)
  where deleted_at is null;
create index ideas_search_idx
  on public.ideas using gin (search_vector)
  where deleted_at is null;
create index projects_search_idx
  on public.projects using gin (search_vector)
  where deleted_at is null;
create index classes_search_idx
  on public.classes using gin (search_vector);
create index class_notes_search_idx
  on public.class_notes using gin (search_vector);

-- Search results name more kinds than soft delete and restore accept, and a
-- class has a text primary key rather than a UUID. Both stay their own contract:
-- public.orbitos_record_type is still exactly what those two RPCs take.
create type public.search_record_type as enum (
  'todo',
  'assignment',
  'idea',
  'project',
  'class',
  'class_note'
);

drop function public.search_records(text, integer, integer);

create function public.search_records(
  p_query text,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table (
  record_type public.search_record_type,
  record_id text,
  parent_id text,
  title text,
  snippet text,
  updated_at timestamptz,
  relevance real,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query_text text := btrim(coalesce(p_query, ''));
  v_query tsquery;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  if char_length(v_query_text) > 256 then
    raise exception using
      errcode = '22023',
      message = 'search query is too long';
  end if;

  if p_limit is null
    or p_limit < 1
    or p_limit > 100
    or p_offset is null
    or p_offset < 0
    or p_offset > 10000 then
    raise exception using
      errcode = '22023',
      message = 'invalid search pagination';
  end if;

  if v_query_text = '' then
    return;
  end if;

  -- A query of nothing but English stopwords ('IT') stems away to an empty
  -- query. The literal configuration keeps it, and identifiers are indexed
  -- under that configuration too, so a course code still finds its class.
  v_query := websearch_to_tsquery('english'::regconfig, v_query_text);
  if numnode(v_query) = 0 or querytree(v_query)::text in ('', 'T') then
    v_query := websearch_to_tsquery('simple'::regconfig, v_query_text);
  end if;

  -- A query that is empty, or only negations, would otherwise match everything.
  if numnode(v_query) = 0 or querytree(v_query)::text in ('', 'T') then
    return;
  end if;

  return query
  with matches as (
    select
      case when t.class_id is null then 'todo' else 'assignment' end
        ::public.search_record_type as record_type,
      t.id::text as record_id,
      t.class_id as parent_id,
      left(t.text, 160) as title,
      left(t.text, 200) as snippet,
      t.updated_at,
      ts_rank_cd(t.search_vector, v_query)::real as relevance
    from public.todos as t
    where t.user_id = (select auth.uid())
      and t.deleted_at is null
      and t.search_vector @@ v_query

    union all

    select
      'idea'::public.search_record_type,
      i.id::text,
      null::text,
      left(coalesce(i.title, left(i.body, 80)), 160),
      left(i.body, 200),
      i.updated_at,
      ts_rank_cd(i.search_vector, v_query)::real
    from public.ideas as i
    where i.user_id = (select auth.uid())
      and i.deleted_at is null
      and i.search_vector @@ v_query

    union all

    select
      'project'::public.search_record_type,
      p.id::text,
      null::text,
      left(p.title, 160),
      left(coalesce(p.description, ''), 200),
      p.updated_at,
      ts_rank_cd(p.search_vector, v_query)::real
    from public.projects as p
    where p.user_id = (select auth.uid())
      and p.deleted_at is null
      and p.search_vector @@ v_query

    union all

    select
      'class'::public.search_record_type,
      c.id,
      null::text,
      left(coalesce(c.name, c.id), 160),
      case when c.name is null then '' else c.id end,
      c.updated_at,
      ts_rank_cd(c.search_vector, v_query)::real
    from public.classes as c
    where c.user_id = (select auth.uid())
      and c.search_vector @@ v_query

    union all

    select
      'class_note'::public.search_record_type,
      n.id::text,
      n.course_id,
      left(n.name, 160),
      -- The course code is already the note's parent_id; repeating it as the
      -- snippet would print it twice in a result row.
      '',
      n.updated_at,
      ts_rank_cd(n.search_vector, v_query)::real
    from public.class_notes as n
    where n.user_id = (select auth.uid())
      and n.search_vector @@ v_query
  ),
  counted as (
    select
      matches.*,
      count(*) over () as total_count
    from matches
  )
  select
    counted.record_type,
    counted.record_id,
    counted.parent_id,
    counted.title,
    counted.snippet,
    counted.updated_at,
    counted.relevance,
    counted.total_count
  from counted
  order by
    counted.relevance desc,
    counted.updated_at desc,
    counted.record_type,
    counted.record_id
  limit p_limit
  offset p_offset;
end
$$;

revoke all on function public.search_records(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_records(text, integer, integer)
  to authenticated;

end
$migration$;
