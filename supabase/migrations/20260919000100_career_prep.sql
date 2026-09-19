-- Career prep. An application is one company and one role; hanging off it are
-- the rounds of its process, the questions you were asked, the things you still
-- have to prepare, and the files you sent. Everything is owner-scoped under RLS
-- and written through column grants like the rest of the workspace.
--
-- Two things the page shows are deliberately not columns here. The next step is
-- the earliest round that is not done, read from career_steps; storing it would
-- be a second copy to keep true. The stage counts under the heading are a count
-- over stage. Both are derived on every read.
--
-- Behavioural stories are the exception: a story is written once and used at
-- every company, so it belongs to the account rather than to one application,
-- and career_story_uses records where it has been told.
--
-- A resource is a file or a link. A file is uploaded from this computer, never
-- from Drive: a private bucket and the reserve/upload/finish order class notes
-- already use, so an interrupted upload leaves an account-owned row to resume
-- rather than orphaned bytes. There is no Drive picker and no Drive consent.
--
-- Deleting an application is the soft delete every other record uses, so undo
-- works the way it does on projects. That means one more value on
-- public.orbitos_record_type and a branch in the two RPCs that read it. Adding
-- an enum value is safe inside this transaction because nothing here writes the
-- new value; the RPC bodies are plpgsql and plan their statements on first
-- call, after the commit.
--
-- One statement keeps the type, table, policy, and function changes atomic even
-- when the Supabase CLI applies migration statements separately.
alter type public.orbitos_record_type add value if not exists 'application';
alter type public.search_record_type add value if not exists 'application';

do $migration$
begin

create type public.career_stage as enum (
  'interested',
  'applied',
  'screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn'
);

-- One vocabulary for the resources tab: a file uploaded from this computer, or
-- a link to something worth reading. Neither is a special case of the other.
create type public.career_resource_kind as enum ('file', 'link');

-- Tags are what make a question findable across companies, so the database owns
-- their shape rather than trusting each writer. It normalizes rather than
-- refuses: "System Design " and "system design" are the same tag, and typing
-- either has to land in the same bucket, so casing, padding, blanks and
-- duplicates are corrected in place. Only the limits a page cannot silently fix
-- -- too many tags, or one too long -- are errors.
create function private.normalize_career_tags()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tags text[];
begin
  select coalesce(array_agg(distinct normalized.tag order by normalized.tag), '{}'::text[])
  into v_tags
  from unnest(coalesce(new.tags, '{}'::text[])) as raw (tag),
    lateral (select lower(btrim(raw.tag)) as tag) as normalized
  where normalized.tag <> '';

  if coalesce(array_length(v_tags, 1), 0) > 12 then
    raise exception using
      errcode = '22023',
      message = 'Use 12 tags or fewer.';
  end if;
  if exists (select 1 from unnest(v_tags) as tag where char_length(tag) > 40) then
    raise exception using
      errcode = '22023',
      message = 'Keep each tag to 40 characters or fewer.';
  end if;

  new.tags := v_tags;
  return new;
end
$$;
revoke all on function private.normalize_career_tags()
  from public, anon, authenticated, service_role, orbitos_rpc;

create table public.career_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  company text not null,
  -- "role" is a non-reserved keyword, so it is a legal column name and reads
  -- the way the page does. It is never the SQL role of the caller.
  role text not null,
  -- Null until you send it, so a row can exist while you are only interested.
  applied_on date,
  stage public.career_stage not null default 'interested',
  posting_url text,
  location text,
  -- Free-form markdown: the "how it goes" block. A table of fixed stages would
  -- only fit the processes it was designed for.
  process_notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  -- The company outranks the role, so searching a company lists its
  -- application above a role that merely mentions the word. Both are indexed
  -- literally as well as stemmed: a company name is not English prose
  -- ("Stripe" stems to "stripe", "IT" stems to nothing at all).
  search_vector tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, company), 'A') ||
    setweight(to_tsvector('simple'::regconfig, company), 'A') ||
    setweight(to_tsvector('english'::regconfig, role), 'B') ||
    setweight(to_tsvector('simple'::regconfig, role), 'B')
  ) stored,
  constraint career_applications_company_bounded check (
    btrim(company) = company
    and company <> ''
    and char_length(company) <= 120
  ),
  constraint career_applications_role_bounded check (
    btrim(role) = role
    and role <> ''
    and char_length(role) <= 160
  ),
  constraint career_applications_location_bounded check (
    location is null or (
      btrim(location) = location
      and location <> ''
      and char_length(location) <= 120
    )
  ),
  constraint career_applications_posting_url_bounded check (
    posting_url is null or (
      posting_url ~ '^https?://[^[:space:]]+$'
      and char_length(posting_url) <= 2048
    )
  ),
  constraint career_applications_process_notes_bounded check (
    process_notes is null or char_length(process_notes) <= 40000
  ),
  -- A child row names its parent by owner as well as id, so a foreign key
  -- cannot reach across accounts even if a row id is guessed.
  constraint career_applications_owner_id_unique unique (user_id, id)
);

-- The page's own order is next step first, then applied_on descending; this is
-- the second half of it, and the rows with no date yet sort last.
create index career_applications_owner_recent
  on public.career_applications (user_id, applied_on desc nulls last, created_at desc, id)
  where deleted_at is null;
create index career_applications_search_idx
  on public.career_applications using gin (search_vector)
  where deleted_at is null;

alter table public.career_applications enable row level security;
revoke all on public.career_applications
  from public, anon, authenticated, service_role;
grant select on public.career_applications to authenticated;
-- deleted_at is absent from both grants on purpose: deletion and undo go
-- through soft_delete_record and restore_record, as they do for every other
-- record, so the browser never hard deletes and never erases by hand.
grant insert (
  id, user_id, company, role, applied_on, stage, posting_url, location,
  process_notes
) on public.career_applications to authenticated;
grant update (
  company, role, applied_on, stage, posting_url, location, process_notes
) on public.career_applications to authenticated;

-- A soft-deleted application leaves the browser's view entirely, as a deleted
-- task or project does. Undo works from the timestamp the delete returned, not
-- from reading the hidden row back.
create policy career_applications_read on public.career_applications
  for select to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null);
create policy career_applications_create on public.career_applications
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy career_applications_write on public.career_applications
  for update to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null)
  with check ((select auth.uid()) = user_id);

-- The soft-delete RPCs run as orbitos_rpc, which reaches exactly one column on
-- exactly the caller's own rows, the posture todos, ideas and projects have.
grant select on table public.career_applications to orbitos_rpc;
grant update (deleted_at) on table public.career_applications to orbitos_rpc;

create policy career_applications_rpc_select_own on public.career_applications
  for select to orbitos_rpc
  using ((select internal.request_user_id()) = user_id);
create policy career_applications_rpc_update_own on public.career_applications
  for update to orbitos_rpc
  using ((select internal.request_user_id()) = user_id)
  with check ((select internal.request_user_id()) = user_id);

create trigger career_applications_set_updated_at
  before update on public.career_applications
  for each row execute function private.set_updated_at();

-- The rounds of one process, in the order they happen. The next step the table
-- shows is read from here: the earliest row that is not done, by scheduled_on.
create table public.career_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  application_id uuid not null,
  name text not null,
  -- Null reads as "not scheduled" on the page.
  scheduled_on date,
  -- Order down the page, reordered by drag. Gaps are expected: a reorder
  -- rewrites the positions it has to and leaves the rest alone.
  position integer not null default 0,
  -- Null until the round happens; a done step is struck through.
  done_at timestamptz,
  notes text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint career_steps_name_bounded check (
    btrim(name) <> '' and char_length(name) <= 160
  ),
  constraint career_steps_notes_bounded check (
    notes is null or char_length(notes) <= 40000
  ),
  constraint career_steps_position_bounded check (
    position between 0 and 1000000
  ),
  constraint career_steps_owner
    foreign key (user_id, application_id)
    references public.career_applications (user_id, id)
    on delete cascade
);

create index career_steps_application
  on public.career_steps (user_id, application_id, position, id);
-- The derived next step, for the whole table in one read.
create index career_steps_next
  on public.career_steps (user_id, scheduled_on nulls last, position, id)
  where done_at is null;

alter table public.career_steps enable row level security;
revoke all on public.career_steps from public, anon, authenticated, service_role;
grant select, delete on public.career_steps to authenticated;
grant insert (id, user_id, application_id, name, scheduled_on, position, done_at, notes)
  on public.career_steps to authenticated;
grant update (name, scheduled_on, position, done_at, notes)
  on public.career_steps to authenticated;

create policy career_steps_read on public.career_steps
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy career_steps_create on public.career_steps
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy career_steps_write on public.career_steps
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy career_steps_delete on public.career_steps
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger career_steps_set_updated_at
  before update on public.career_steps
  for each row execute function private.set_updated_at();

-- A question belongs to one application; the tags are what reach across them,
-- so "system design" asked at three companies is one filter rather than three.
create table public.career_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  application_id uuid not null,
  body text not null,
  answer text,
  tags text[] not null default '{}',
  -- Null while it is still only something to prepare for.
  asked_on date,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint career_questions_body_bounded check (
    btrim(body) <> '' and char_length(body) <= 4000
  ),
  constraint career_questions_answer_bounded check (
    answer is null or char_length(answer) <= 40000
  ),
  constraint career_questions_owner
    foreign key (user_id, application_id)
    references public.career_applications (user_id, id)
    on delete cascade
);

create index career_questions_application
  on public.career_questions (user_id, application_id, created_at, id);
-- Filtering by tag is the cross-company view, so it is an index, not a scan.
create index career_questions_tags_idx
  on public.career_questions using gin (tags);

alter table public.career_questions enable row level security;
revoke all on public.career_questions
  from public, anon, authenticated, service_role;
grant select, delete on public.career_questions to authenticated;
grant insert (id, user_id, application_id, body, answer, tags, asked_on)
  on public.career_questions to authenticated;
grant update (body, answer, tags, asked_on)
  on public.career_questions to authenticated;

create policy career_questions_read on public.career_questions
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy career_questions_create on public.career_questions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy career_questions_write on public.career_questions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy career_questions_delete on public.career_questions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger career_questions_normalize_tags
  before insert or update of tags on public.career_questions
  for each row execute function private.normalize_career_tags();

create trigger career_questions_set_updated_at
  before update on public.career_questions
  for each row execute function private.set_updated_at();

-- One thing to prepare. "Send to tasks" turns it into a real task and records
-- which one, the way an assignment is a task.
create table public.career_prep (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  application_id uuid not null,
  body text not null,
  -- A past date reads "2 days late" on the page.
  due_on date,
  -- Ticking it strikes the line through.
  done_at timestamptz,
  todo_id uuid,
  position integer not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint career_prep_body_bounded check (
    btrim(body) <> '' and char_length(body) <= 2000
  ),
  constraint career_prep_position_bounded check (
    position between 0 and 1000000
  ),
  constraint career_prep_owner
    foreign key (user_id, application_id)
    references public.career_applications (user_id, id)
    on delete cascade,
  -- The task may be deleted from the Tasks board without taking the prep item
  -- with it; the link simply goes quiet.
  constraint career_prep_todo_same_owner
    foreign key (user_id, todo_id)
    references public.todos (user_id, id)
    on delete set null (todo_id)
);

create index career_prep_application
  on public.career_prep (user_id, application_id, position, id);

alter table public.career_prep enable row level security;
revoke all on public.career_prep from public, anon, authenticated, service_role;
grant select, delete on public.career_prep to authenticated;
grant insert (id, user_id, application_id, body, due_on, done_at, todo_id, position)
  on public.career_prep to authenticated;
grant update (body, due_on, done_at, todo_id, position)
  on public.career_prep to authenticated;

create policy career_prep_read on public.career_prep
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy career_prep_create on public.career_prep
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy career_prep_write on public.career_prep
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy career_prep_delete on public.career_prep
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger career_prep_set_updated_at
  before update on public.career_prep
  for each row execute function private.set_updated_at();

-- Behavioural stories are the one thing here that does not hang off an
-- application: a story is written once and used at every company, so it belongs
-- to the account. career_story_uses records where each one has been told.
create table public.career_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  title text not null,
  -- Markdown: situation, what you did, result.
  body text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint career_stories_title_bounded check (
    btrim(title) <> '' and char_length(title) <= 160
  ),
  constraint career_stories_body_bounded check (
    btrim(body) <> '' and char_length(body) <= 40000
  ),
  constraint career_stories_owner_id_unique unique (user_id, id)
);

-- The story you last sharpened sorts first.
create index career_stories_recent
  on public.career_stories (user_id, updated_at desc, id);
create index career_stories_tags_idx
  on public.career_stories using gin (tags);

alter table public.career_stories enable row level security;
revoke all on public.career_stories from public, anon, authenticated, service_role;
grant select, delete on public.career_stories to authenticated;
grant insert (id, user_id, title, body, tags) on public.career_stories to authenticated;
grant update (title, body, tags) on public.career_stories to authenticated;

create policy career_stories_read on public.career_stories
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy career_stories_create on public.career_stories
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy career_stories_write on public.career_stories
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy career_stories_delete on public.career_stories
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger career_stories_normalize_tags
  before insert or update of tags on public.career_stories
  for each row execute function private.normalize_career_tags();

create trigger career_stories_set_updated_at
  before update on public.career_stories
  for each row execute function private.set_updated_at();

-- Where a story has been told. The pair is the key, so recording the same use
-- twice is one row, and the prep tab reads it as "used at Ramp, Linear".
create table public.career_story_uses (
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  story_id uuid not null,
  application_id uuid not null,
  used_on date,
  created_at timestamptz not null default statement_timestamp(),
  primary key (story_id, application_id),
  constraint career_story_uses_story
    foreign key (user_id, story_id)
    references public.career_stories (user_id, id)
    on delete cascade,
  constraint career_story_uses_application
    foreign key (user_id, application_id)
    references public.career_applications (user_id, id)
    on delete cascade
);

create index career_story_uses_application
  on public.career_story_uses (user_id, application_id, story_id);

alter table public.career_story_uses enable row level security;
revoke all on public.career_story_uses from public, anon, authenticated, service_role;
grant select, delete on public.career_story_uses to authenticated;
grant insert (user_id, story_id, application_id, used_on)
  on public.career_story_uses to authenticated;
grant update (used_on) on public.career_story_uses to authenticated;

create policy career_story_uses_read on public.career_story_uses
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy career_story_uses_create on public.career_story_uses
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy career_story_uses_write on public.career_story_uses
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy career_story_uses_delete on public.career_story_uses
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- One table for the resources tab, so it is one vocabulary. A file is
-- class_notes without its Drive half; a link is a URL and a title and needs no
-- bucket at all. The object path is derived from the owner and the row id
-- rather than the filename, so two files called "resume.pdf" cannot collide and
-- a filename can never escape its own folder.
create table public.career_resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  application_id uuid not null,
  kind public.career_resource_kind not null,
  title text not null,
  url text,
  content_type text,
  byte_size bigint,
  content_sha256 text,
  object_path text generated always as (
    case when kind = 'file' then
      user_id::text || '/' || id::text || case content_type
        when 'application/pdf' then '.pdf'
        when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then '.docx'
        when 'text/markdown' then '.md'
        else '.txt'
      end
    end
  ) stored,
  uploaded_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint career_resources_title_bounded check (
    btrim(title) = title and title <> '' and char_length(title) <= 255
  ),
  constraint career_resources_url_bounded check (
    url is null or (
      url ~ '^https?://[^[:space:]]+$' and char_length(url) <= 2048
    )
  ),
  constraint career_resources_content_type check (
    content_type is null or content_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown',
      'text/plain'
    )
  ),
  constraint career_resources_size_bounded check (
    byte_size is null or byte_size between 1 and 26214400
  ),
  constraint career_resources_hash check (
    content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  -- Each kind carries its own half of the row and none of the other's, so a
  -- link can never claim a stored object and a file can never be a bare URL.
  constraint career_resources_kind_shape check (
    (kind = 'link'
      and url is not null
      and content_type is null
      and byte_size is null
      and content_sha256 is null
      and uploaded_at is null)
    or (kind = 'file'
      and url is null
      and content_type is not null
      and byte_size is not null
      and content_sha256 is not null)
  ),
  constraint career_resources_owner
    foreign key (user_id, application_id)
    references public.career_applications (user_id, id)
    on delete cascade,
  unique (object_path)
);

create index career_resources_application
  on public.career_resources (user_id, application_id, kind, created_at, id);

alter table public.career_resources enable row level security;
revoke all on public.career_resources from public, anon, authenticated, service_role;
grant select, delete on public.career_resources to authenticated;
-- uploaded_at is not grantable: only finish_career_resource() sets it, after
-- checking the bytes actually landed.
grant insert (
  id, user_id, application_id, kind, title, url, content_type, byte_size,
  content_sha256
) on public.career_resources to authenticated;
grant update (title, url) on public.career_resources to authenticated;

create policy career_resources_read on public.career_resources
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy career_resources_create on public.career_resources
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy career_resources_write on public.career_resources
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy career_resources_delete on public.career_resources
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger career_resources_set_updated_at
  before update on public.career_resources
  for each row execute function private.set_updated_at();

-- Private, immutable file objects, exactly as class PDFs are stored. The row is
-- reserved first, so bytes that arrive always have an owner.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values (
    'career-resources',
    'career-resources',
    false,
    26214400,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown',
      'text/plain'
    ]
  )
  -- Local migration rewind preserves Storage buckets. Reapply the private
  -- configuration without deleting any existing objects.
  on conflict (id) do update set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy career_resource_read on storage.objects
  for select to authenticated using (
    bucket_id = 'career-resources' and exists (
      select 1 from public.career_resources as r
      where r.user_id = (select auth.uid())
        and r.object_path = storage.objects.name
    )
  );
create policy career_resource_upload on storage.objects
  for insert to authenticated with check (
    bucket_id = 'career-resources' and exists (
      select 1 from public.career_resources as r
      where r.user_id = (select auth.uid())
        and r.object_path = storage.objects.name
        and r.uploaded_at is null
    )
  );
-- No UPDATE policy: a stored file is never overwritten in place. Replacing one
-- means a new row, which reserves a new path.
create policy career_resource_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'career-resources' and exists (
      select 1 from public.career_resources as r
      where r.user_id = (select auth.uid())
        and r.object_path = storage.objects.name
    )
  );

-- SECURITY DEFINER so it can read Storage metadata the browser cannot. The row
-- is found by the caller's own uid, so it can only ever finalize their upload.
-- Storage publishes a sha256 for some uploads and not others; when it does, the
-- bytes are checked against the hash the browser computed before sending.
create function public.finish_career_resource(p_resource_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource public.career_resources%rowtype;
  object_hash text;
begin
  select * into resource
  from public.career_resources
  where id = p_resource_id and user_id = auth.uid() and kind = 'file'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'File unavailable.';
  end if;
  if resource.uploaded_at is not null then
    return;
  end if;
  select o.metadata->>'sha256' into object_hash
  from storage.objects as o
  where o.bucket_id = 'career-resources'
    and o.name = resource.object_path
    and o.metadata->>'mimetype' = resource.content_type
    and (o.metadata->>'size')::bigint = resource.byte_size;
  if not found then
    raise exception using errcode = '22023',
      message = 'Upload is incomplete. Choose the same file to finish saving.';
  end if;
  if object_hash is not null and object_hash is distinct from resource.content_sha256 then
    raise exception using errcode = '22023',
      message = 'The stored file does not match this upload. Choose the same file to finish saving.';
  end if;
  update public.career_resources
  set uploaded_at = clock_timestamp()
  where id = resource.id and user_id = auth.uid();
end
$$;
revoke all on function public.finish_career_resource(uuid)
  from public, anon, service_role;
grant execute on function public.finish_career_resource(uuid) to authenticated;

-- Abandoned reservations, the same 24-hour rule class PDFs use. Returns the
-- paths whose bytes did arrive but were never finalized; the caller deletes
-- exactly those through the service-role Storage API, which frees the bytes.
create function private.reap_abandoned_career_resources()
returns setof text
language sql
security definer
set search_path = ''
as $$
  with abandoned as (
    delete from public.career_resources as r
    where r.kind = 'file'
      and r.uploaded_at is null
      and r.created_at < clock_timestamp() - interval '24 hours'
    returning r.object_path
  )
  select a.object_path
  from abandoned as a
  join storage.objects as o
    on o.bucket_id = 'career-resources' and o.name = a.object_path;
$$;
revoke all on function private.reap_abandoned_career_resources()
  from public, anon, authenticated, service_role, orbitos_rpc;
grant execute on function private.reap_abandoned_career_resources() to service_role;

-- Soft delete and undo. Both RPCs gain one branch; nothing else about them
-- changes, and their signatures are unchanged, so existing callers and the
-- generated types for them stay as they are.
create or replace function internal.soft_delete_record(
  p_record_type public.orbitos_record_type,
  p_record_id uuid
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
set row_security = on
as $$
declare
  v_uid uuid := internal.request_user_id();
  v_deleted_at timestamptz := statement_timestamp();
  v_result timestamptz;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  case p_record_type
    when 'todo' then
      update public.todos
      set deleted_at = v_deleted_at,
          today_rank = null
      where id = p_record_id
        and user_id = v_uid
        and deleted_at is null
      returning deleted_at into v_result;
    when 'idea' then
      update public.ideas
      set deleted_at = v_deleted_at
      where id = p_record_id
        and user_id = v_uid
        and deleted_at is null
      returning deleted_at into v_result;
    when 'project' then
      update public.projects
      set deleted_at = v_deleted_at
      where id = p_record_id
        and user_id = v_uid
        and deleted_at is null
      returning deleted_at into v_result;
    when 'application' then
      update public.career_applications
      set deleted_at = v_deleted_at
      where id = p_record_id
        and user_id = v_uid
        and deleted_at is null
      returning deleted_at into v_result;
    else
      raise exception using
        errcode = '22023',
        message = 'invalid record type';
  end case;

  return v_result;
end
$$;

create or replace function internal.restore_record(
  p_record_type public.orbitos_record_type,
  p_record_id uuid,
  p_deleted_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
set row_security = on
as $$
declare
  v_uid uuid := internal.request_user_id();
  v_restored_count bigint := 0;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  case p_record_type
    when 'todo' then
      update public.todos
      set deleted_at = null,
          today_rank = null
      where id = p_record_id
        and user_id = v_uid
        and deleted_at = p_deleted_at;
    when 'idea' then
      update public.ideas
      set deleted_at = null
      where id = p_record_id
        and user_id = v_uid
        and deleted_at = p_deleted_at;
    when 'project' then
      update public.projects
      set deleted_at = null
      where id = p_record_id
        and user_id = v_uid
        and deleted_at = p_deleted_at;
    when 'application' then
      update public.career_applications
      set deleted_at = null
      where id = p_record_id
        and user_id = v_uid
        and deleted_at = p_deleted_at;
    else
      raise exception using
        errcode = '22023',
        message = 'invalid record type';
  end case;

  get diagnostics v_restored_count = row_count;
  return v_restored_count > 0;
end
$$;

-- Workspace search reaches applications. The shape of search_records is
-- unchanged; only the applications branch and the new record type are added, so
-- the browser's result list keeps the columns it already renders.
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

    union all

    -- The company is the title because that is how an application is looked
    -- for; the role is the line under it.
    select
      'application'::public.search_record_type,
      a.id::text,
      null::text,
      left(a.company, 160),
      left(a.role, 200),
      a.updated_at,
      ts_rank_cd(a.search_vector, v_query)::real
    from public.career_applications as a
    where a.user_id = (select auth.uid())
      and a.deleted_at is null
      and a.search_vector @@ v_query
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

notify pgrst, 'reload schema';

end
$migration$;
