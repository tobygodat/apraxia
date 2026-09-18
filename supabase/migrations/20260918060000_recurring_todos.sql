-- Recurring tasks. Completing one occurrence materializes the next, so a weekly
-- problem set is typed once. Exactly one occurrence is ever open at a time:
-- nothing is generated in advance and no scheduled job is involved.
do $migration$
begin

create type public.todo_recurrence_freq as enum ('daily', 'weekly', 'monthly');

alter table public.todos
  add column recurrence_freq public.todo_recurrence_freq,
  add column recurrence_interval integer,
  add column recurrence_until date,
  -- Database-owned: the series link and the spawn marker are never browser input.
  add column recurrence_series_id uuid,
  add column recurrence_spawned_at timestamptz,
  add constraint todos_recurrence_complete check (
    (
      recurrence_freq is null
      and recurrence_interval is null
      and recurrence_until is null
      and recurrence_series_id is null
    )
    or (
      recurrence_freq is not null
      and recurrence_interval between 1 and 52
      and recurrence_series_id is not null
    )
  ),
  -- The due date is the anchor every later occurrence is measured from.
  add constraint todos_recurrence_requires_due_date check (
    recurrence_freq is null or due_date is not null
  ),
  add constraint todos_recurrence_until_after_due check (
    recurrence_until is null or due_date is null or recurrence_until >= due_date
  );

-- A rule implies its own series and interval; dropping the rule drops both.
create function private.sync_todo_recurrence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recurrence_freq is null then
    new.recurrence_interval := null;
    new.recurrence_until := null;
    new.recurrence_series_id := null;
  else
    new.recurrence_interval := coalesce(new.recurrence_interval, 1);
    new.recurrence_series_id := coalesce(
      new.recurrence_series_id,
      pg_catalog.gen_random_uuid()
    );
  end if;

  return new;
end
$$;

revoke all on function private.sync_todo_recurrence()
  from public, anon, authenticated, service_role, orbitos_rpc;

-- SECURITY DEFINER because the successor carries columns the browser may not
-- write. Its owner comes from the row the caller just updated under RLS, so the
-- elevated insert can only ever land in the caller's own account.
create function private.spawn_recurring_todo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step interval := case new.recurrence_freq
    when 'daily' then pg_catalog.make_interval(days => new.recurrence_interval)
    when 'weekly' then pg_catalog.make_interval(weeks => new.recurrence_interval)
    when 'monthly' then pg_catalog.make_interval(months => new.recurrence_interval)
  end;
  v_local_today date;
  v_next date := old.due_date;
begin
  select (
    statement_timestamp() at time zone profile.timezone
  )::date
  into v_local_today
  from public.profiles as profile
  where profile.user_id = old.user_id;

  v_local_today := coalesce(
    v_local_today,
    (statement_timestamp() at time zone 'America/New_York')::date
  );

  -- Finishing Wednesday's problem set late must produce next Monday, not the
  -- Monday that has already gone by, so step past today rather than once.
  -- The bound keeps a long-abandoned daily task from looping indefinitely.
  for v_iteration in 1..400 loop
    v_next := (v_next + v_step)::date;
    exit when v_next >= v_local_today;
  end loop;

  if new.recurrence_until is not null and v_next > new.recurrence_until then
    new.recurrence_spawned_at := statement_timestamp();
    return new;
  end if;

  insert into public.todos (
    user_id,
    text,
    due_date,
    due_time,
    project_id,
    class_id,
    assignment_type,
    recurrence_freq,
    recurrence_interval,
    recurrence_until,
    recurrence_series_id
  )
  values (
    old.user_id,
    old.text,
    v_next,
    old.due_time,
    old.project_id,
    old.class_id,
    old.assignment_type,
    new.recurrence_freq,
    new.recurrence_interval,
    new.recurrence_until,
    new.recurrence_series_id
  );

  -- Unchecking and rechecking the same occurrence must not spawn a second one.
  new.recurrence_spawned_at := statement_timestamp();
  return new;
end
$$;

revoke all on function private.spawn_recurring_todo()
  from public, anon, authenticated, service_role, orbitos_rpc;

create trigger todos_sync_recurrence
before insert or update of
  recurrence_freq, recurrence_interval, recurrence_until, recurrence_series_id
on public.todos
for each row execute function private.sync_todo_recurrence();

create trigger todos_spawn_recurrence
before update on public.todos
for each row
when (
  new.completed
  and not old.completed
  and new.recurrence_freq is not null
  and new.recurrence_spawned_at is null
  and old.deleted_at is null
  and new.deleted_at is null
)
execute function private.spawn_recurring_todo();

grant insert (recurrence_freq, recurrence_interval, recurrence_until)
  on public.todos to authenticated;
grant update (recurrence_freq, recurrence_interval, recurrence_until)
  on public.todos to authenticated;

notify pgrst, 'reload schema';

end
$migration$;
