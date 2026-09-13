-- Assignments belong to an account and its existing browser-local course ID.
-- No existing classes, tasks, or provider data are modified.
create table public.class_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id text not null check (char_length(course_id) between 1 and 120 and course_id = btrim(course_id)),
  title text not null check (char_length(title) between 1 and 180 and title = btrim(title)),
  due_date date check (due_date between date '0001-01-01' and date '9999-12-31'),
  assignment_type text not null default '' check (assignment_type in ('', 'Homework', 'Quiz', 'Reading', 'Exam', 'Other')),
  completed boolean not null default false
);
create index class_assignments_course on public.class_assignments(user_id, course_id, id);
alter table public.class_assignments enable row level security;
revoke all on public.class_assignments from anon, authenticated;
grant select, insert on public.class_assignments to authenticated;
grant update (title, due_date, assignment_type, completed) on public.class_assignments to authenticated;
create policy class_assignments_select_own on public.class_assignments for select to authenticated
  using ((select auth.uid()) = user_id);
create policy class_assignments_insert_own on public.class_assignments for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy class_assignments_update_own on public.class_assignments for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
