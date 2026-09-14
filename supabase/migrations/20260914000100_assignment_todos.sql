-- Keep schema, copy, and write revocation atomic in statement-based runners.
do $migration$
begin
-- Release with the todo-backed Classes UI. Keep the legacy rows as a backup.
alter table public.todos
  add column class_id text,
  add column assignment_type text not null default '',
  add constraint todos_class_owner foreign key (user_id, class_id)
    references public.classes(user_id, id) on delete set null (class_id),
  add constraint todos_assignment_type check (assignment_type in ('', 'Homework', 'Quiz', 'Reading', 'Exam', 'Other')),
  add constraint todos_assignment_requires_class check (assignment_type = '' or class_id is not null),
  add constraint todos_one_parent check (project_id is null or class_id is null);
create index todos_class on public.todos(user_id, class_id);

-- SET NULL must also remove class-only metadata; never clear the owner or task.
create function internal.clear_detached_assignment_type()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.class_id is not null and new.class_id is null then
    new.assignment_type := '';
  end if;
  return new;
end
$$;
revoke all on function internal.clear_detached_assignment_type() from public, anon, authenticated, service_role;
create trigger todos_clear_detached_assignment_type before update of class_id on public.todos
for each row execute function internal.clear_detached_assignment_type();

grant insert (id, class_id, assignment_type) on public.todos to authenticated;
grant update (class_id, assignment_type) on public.todos to authenticated;

-- Serialize the final copy with old clients before revoking their writes.
lock table public.class_assignments in access exclusive mode;

insert into public.todos (id, user_id, text, due_date, class_id, assignment_type, completed, completed_at, source)
select id, user_id, title, due_date, course_id, assignment_type, completed,
  case when completed then statement_timestamp() else null end, 'manual'
from public.class_assignments
on conflict (id) do nothing;

-- The backup is immutable history and must not prevent deleting a class.
alter table public.class_assignments drop constraint class_assignments_class_owner;

-- Column privileges survive a table-level REVOKE, so revoke both explicitly.
revoke insert, update, delete on public.class_assignments from authenticated;
revoke update (title, due_date, assignment_type, completed) on public.class_assignments from authenticated;
drop policy class_assignments_insert_own on public.class_assignments;
drop policy class_assignments_update_own on public.class_assignments;

-- The page wrapper hashes the complete helper row, including these new fields.
drop function internal.get_today_todos(date);
create function internal.get_today_todos(p_local_date date)
returns table (
  id uuid,
  text text,
  due_date date,
  due_time time without time zone,
  project_id uuid,
  project_title text,
  class_id text,
  class_name text,
  assignment_type text,
  today_rank bigint,
  is_overdue boolean,
  is_manually_ordered boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_local_date date;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  if p_local_date is null then
    raise exception using
      errcode = '22023',
      message = 'local date changed; refresh and try again';
  end if;

  select (
    statement_timestamp() at time zone profile.timezone
  )::date
  into v_profile_local_date
  from public.profiles as profile
  where profile.user_id = v_uid;

  if v_profile_local_date is distinct from p_local_date then
    raise exception using
      errcode = '22023',
      message = 'local date changed; refresh and try again';
  end if;

  return query
  select
    t.id,
    t.text,
    t.due_date,
    t.due_time,
    t.project_id,
    p.title,
    t.class_id,
    c.name,
    t.assignment_type,
    t.today_rank,
    t.due_date < p_local_date,
    t.today_rank is not null,
    t.created_at,
    t.updated_at
  from public.todos as t
  left join public.projects as p
    on p.id = t.project_id
   and p.user_id = t.user_id
   and p.deleted_at is null
  left join public.classes as c on c.user_id = t.user_id and c.id = t.class_id
  where t.user_id = v_uid
    and t.completed_at is null
    and t.deleted_at is null
    and t.due_date is not null
    and t.due_date <= p_local_date
  order by
    case when t.today_rank is null then 1 else 0 end,
    t.today_rank nulls last,
    t.due_date,
    t.due_time nulls last,
    t.created_at,
    t.id;
end
$$;

revoke all on function internal.get_today_todos(date) from public, anon, authenticated, service_role;
grant execute on function internal.get_today_todos(date) to authenticated;
notify pgrst, 'reload schema';

end
$migration$;
