-- Preserve legacy class IDs and assignment data before enforcing relationships.
create table public.classes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 120 and id = btrim(id)),
  name text check (char_length(name) between 1 and 120 and name = btrim(name)),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (user_id, id)
);
insert into public.classes(user_id, id)
  select distinct user_id, course_id from public.class_assignments;
alter table public.class_assignments add constraint class_assignments_class_owner
  foreign key (user_id, course_id) references public.classes(user_id, id);
alter table public.classes enable row level security;
revoke all on public.classes from public, anon, authenticated;
grant select on public.classes to authenticated;
grant insert (user_id, id, name), update (name) on public.classes to authenticated;
create policy classes_read on public.classes for select to authenticated using ((select auth.uid()) = user_id);
create policy classes_create on public.classes for insert to authenticated with check ((select auth.uid()) = user_id and name is not null);
create policy classes_rename on public.classes for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and name is not null);
create trigger classes_updated before update on public.classes for each row execute function private.set_updated_at();

-- Repeated imports may fill recovery names but never overwrite established names.
-- Invoker security means the caller's RLS and column privileges still apply.
create function public.import_classes(p_classes jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare item jsonb;
begin
  if auth.uid() is null or jsonb_typeof(p_classes) is distinct from 'array'
    or jsonb_array_length(p_classes) > 1000 then
    raise exception using errcode = '22023', message = 'Invalid saved classes.';
  end if;
  for item in select value from jsonb_array_elements(p_classes) loop
    if jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'name') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'Invalid saved class.';
    end if;
    insert into public.classes(user_id, id, name) values (auth.uid(), item->>'id', item->>'name')
      on conflict (user_id, id) do update set name = excluded.name where public.classes.name is null;
  end loop;
end $$;
revoke all on function public.import_classes(jsonb) from public, anon;
grant execute on function public.import_classes(jsonb) to authenticated;

create table public.class_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id text not null,
  name text not null check (char_length(name) between 1 and 255 and name = btrim(name)),
  source text not null check (source in ('drive', 'upload')),
  drive_file_id text check (drive_file_id ~ '^[A-Za-z0-9_-]+$' and char_length(drive_file_id) <= 256),
  byte_size bigint check (byte_size between 5 and 52428800),
  content_sha256 text check (content_sha256 ~ '^[a-f0-9]{64}$'),
  object_path text generated always as (case when source = 'upload' then user_id::text || '/' || id::text || '.pdf' end) stored,
  uploaded_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint class_notes_source check (
    (source = 'drive' and drive_file_id is not null and byte_size is null and content_sha256 is null and uploaded_at is null)
    or (source = 'upload' and drive_file_id is null and byte_size is not null and content_sha256 is not null)
  ),
  constraint class_notes_class_owner foreign key (user_id, course_id) references public.classes(user_id, id),
  unique (user_id, course_id, drive_file_id),
  unique (object_path)
);
create index class_notes_course on public.class_notes(user_id, course_id, id);
alter table public.class_notes enable row level security;
revoke all on public.class_notes from public, anon, authenticated;
grant select on public.class_notes to authenticated;
grant insert (id,user_id,course_id,name,source,drive_file_id,byte_size,content_sha256) on public.class_notes to authenticated;
create policy class_notes_read on public.class_notes for select to authenticated using ((select auth.uid()) = user_id);
create policy class_notes_create on public.class_notes for insert to authenticated with check ((select auth.uid()) = user_id);
