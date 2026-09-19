-- A search result prints its title and then its snippet, so the two have to
-- carry different text. For a task they did not: the title was the first 160
-- characters of the task's text and the snippet the first 200, so every task
-- row printed its own text twice, and a task shorter than 160 characters
-- printed it twice in full. An idea with no title had the same shape, because
-- its title fell back to the first 80 characters of the body the snippet then
-- repeated.
--
-- Each branch used to build its own title and snippet, which is how two of
-- them ended up building both out of one field. They now report the two things
-- a row is made of instead: a heading, when the record has a name of its own,
-- and its longer text. The title and the snippet are derived once from that
-- pair, so there is one place where the rule lives:
--
--   * a record with a heading keeps it as the title and its text as the
--     snippet, as before;
--   * a record without one (a task, an untitled idea) is titled by the opening
--     of its own text, and the snippet is what the title did not already show,
--     empty when the title showed all of it;
--   * a snippet equal to its title is dropped rather than printed twice.
--
-- A title cut at 160 characters is cut back to the last word boundary, so a
-- long task reads as a sentence continued by its snippet rather than one split
-- through a word. An untitled idea's title is cut at 160 like everything else
-- now, rather than at 80.
--
-- Only the returned text changes; the signature, the vectors, the indexes, the
-- kinds, and the grants are the ones
-- 20260918020000_search_classes_and_stemming.sql left.
create or replace function public.search_records(
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
    -- A task has no name of its own: its text is all it is.
    select
      case when t.class_id is null then 'todo' else 'assignment' end
        ::public.search_record_type as record_type,
      t.id::text as record_id,
      t.class_id as parent_id,
      null::text as heading,
      t.text as body,
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
      i.title,
      i.body,
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
      p.title,
      p.description,
      p.updated_at,
      ts_rank_cd(p.search_vector, v_query)::real
    from public.projects as p
    where p.user_id = (select auth.uid())
      and p.deleted_at is null
      and p.search_vector @@ v_query

    union all

    -- A class recovered without a name is titled by the course code, and then
    -- that code is not repeated underneath it.
    select
      'class'::public.search_record_type,
      c.id,
      null::text,
      coalesce(c.name, c.id),
      case when c.name is null then null else c.id end,
      c.updated_at,
      ts_rank_cd(c.search_vector, v_query)::real
    from public.classes as c
    where c.user_id = (select auth.uid())
      and c.search_vector @@ v_query

    union all

    -- The course code is already the note's parent_id, so the note carries no
    -- text under its filename.
    select
      'class_note'::public.search_record_type,
      n.id::text,
      n.course_id,
      n.name,
      null::text,
      n.updated_at,
      ts_rank_cd(n.search_vector, v_query)::real
    from public.class_notes as n
    where n.user_id = (select auth.uid())
      and n.search_vector @@ v_query
  ),
  named as (
    select
      m.*,
      -- What the title is cut from: the record's own name, or its text.
      coalesce(m.heading, m.body, '') as source
    from matches as m
  ),
  titled as (
    select
      n.*,
      case
        when char_length(n.source) <= 160 then n.source
        -- 161 characters cut back to the last word boundary, so a title that
        -- has to be cut still ends on a whole word.
        else left(regexp_replace(left(n.source, 161), '\s\S*$', ''), 160)
      end as title
    from named as n
  ),
  described as (
    select
      t.*,
      case
        -- The title is the opening of the text itself, so the snippet carries
        -- what is left of that text instead of repeating it.
        when t.heading is null
          then btrim(substr(coalesce(t.body, ''), char_length(t.title) + 1, 200))
        else left(coalesce(t.body, ''), 200)
      end as snippet
    from titled as t
  ),
  counted as (
    select
      described.*,
      count(*) over () as total_count
    from described
  )
  select
    counted.record_type,
    counted.record_id,
    counted.parent_id,
    counted.title,
    -- A record whose two fields hold the same words (an idea titled with its
    -- own body, a project described by its title) would print that text twice.
    case when counted.snippet = counted.title then '' else counted.snippet end,
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
