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
  -- Database-owned. The series link, the date the series counts from, and the
  -- link to the occurrence this one created are never browser input.
  add column recurrence_series_id uuid,
  add column recurrence_anchor_date date,
  add column recurrence_spawned_id uuid,
  add constraint todos_recurrence_complete check (
    (
      recurrence_freq is null
      and recurrence_interval is null
      and recurrence_until is null
      and recurrence_series_id is null
      and recurrence_anchor_date is null
    )
    or (
      recurrence_freq is not null
      and recurrence_interval between 1 and 52
      and recurrence_series_id is not null
      and recurrence_anchor_date is not null
    )
  ),
  -- The due date is the anchor every later occurrence is measured from.
  add constraint todos_recurrence_requires_due_date check (
    recurrence_freq is null or due_date is not null
  ),
  add constraint todos_recurrence_until_after_due check (
    recurrence_until is null or due_date is null or recurrence_until >= due_date
  ),
  -- Every occurrence sits a whole number of periods after the series anchor.
  add constraint todos_recurrence_anchor_not_after_due check (
    recurrence_anchor_date is null
    or due_date is null
    or recurrence_anchor_date <= due_date
  ),
  add constraint todos_owner_id_unique unique (user_id, id),
  add constraint todos_recurrence_spawned_same_owner
    foreign key (user_id, recurrence_spawned_id)
    references public.todos (user_id, id)
    on delete set null (recurrence_spawned_id);

-- A rule implies its own series, interval and anchor; dropping the rule drops
-- all three. Rescheduling a repeating task by hand re-anchors its series.
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
    new.recurrence_anchor_date := null;
  else
    new.recurrence_interval := coalesce(new.recurrence_interval, 1);
    new.recurrence_series_id := coalesce(
      new.recurrence_series_id,
      pg_catalog.gen_random_uuid()
    );
    -- A successor arrives carrying the series anchor and keeps it. Anything the
    -- browser writes has no anchor of its own, so the due date becomes one.
    if tg_op = 'INSERT' then
      new.recurrence_anchor_date := coalesce(
        new.recurrence_anchor_date,
        new.due_date
      );
    elsif new.due_date is distinct from old.due_date
      or new.recurrence_anchor_date is null
      or new.recurrence_anchor_date > new.due_date
    then
      new.recurrence_anchor_date := new.due_date;
    end if;
  end if;

  return new;
end
$$;

revoke all on function private.sync_todo_recurrence()
  from public, anon, authenticated, service_role, orbitos_rpc;

-- SECURITY DEFINER because the successor carries columns the browser may not
-- write. Its owner comes from the row the caller just updated under RLS, so the
-- elevated insert can only ever land in the caller's own account.
--
-- This fires ahead of private.sync_todo_recurrence() on the same statement, so
-- it normalizes the rule itself rather than assuming the sync trigger already
-- ran. In practice a completion update never touches the rule columns, which
-- means the sync trigger does not fire on it at all.
create function private.spawn_recurring_todo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interval integer := coalesce(new.recurrence_interval, 1);
  v_anchor date := coalesce(new.recurrence_anchor_date, new.due_date);
  v_step interval := case new.recurrence_freq
    when 'daily' then pg_catalog.make_interval(days => v_interval)
    when 'weekly' then pg_catalog.make_interval(weeks => v_interval)
    when 'monthly' then pg_catalog.make_interval(months => v_interval)
  end;
  v_local_today date;
  v_target date;
  v_steps integer;
  v_candidate date;
  v_next date;
  v_spawned uuid;
begin
  -- The occurrence this one already created is the guard against a second: an
  -- undone completion withdraws it, so re-completing finds it gone and starts
  -- afresh, while a successor the user kept means there is nothing to create.
  if new.recurrence_spawned_id is not null and exists (
    select 1
    from public.todos as successor
    where successor.id = new.recurrence_spawned_id
      and successor.user_id = old.user_id
      and successor.deleted_at is null
  ) then
    return new;
  end if;

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
  -- Monday that has already gone by, so the successor clears today as well as
  -- the occurrence being completed.
  v_target := greatest(v_local_today, old.due_date);

  -- Every candidate is the series anchor plus a whole number of periods, never
  -- the previous occurrence plus one, so a monthly task anchored on the 31st
  -- returns to the 31st after February instead of ratcheting earlier. The head
  -- start is an undercount by construction: one period spans at most this many
  -- days, so the quotient can never reach past the first occurrence that
  -- clears the target. Without it, a task abandoned for years would cost one
  -- iteration for every period it missed.
  v_steps := greatest(
    1,
    case new.recurrence_freq
      when 'monthly' then (
        (
          extract(year from v_target)::integer
          - extract(year from v_anchor)::integer
        ) * 12
        + (
          extract(month from v_target)::integer
          - extract(month from v_anchor)::integer
        )
      ) / v_interval
      when 'weekly' then (v_target - v_anchor) / (7 * v_interval)
      else (v_target - v_anchor) / v_interval
    end
  );

  -- The head start lands within two periods of the answer for every frequency,
  -- so this bound can only be reached by a logic error, never by old data.
  for v_iteration in 1..400 loop
    v_candidate := (v_anchor + v_step * v_steps)::date;
    if v_candidate > old.due_date and v_candidate >= v_local_today then
      v_next := v_candidate;
      exit;
    end if;
    v_steps := v_steps + 1;
  end loop;

  if v_next is null then
    raise exception 'recurrence did not converge for todo %', old.id;
  end if;

  if new.recurrence_until is not null and v_next > new.recurrence_until then
    -- The series has run out. Nothing is created, so nothing is linked, and
    -- completing this occurrence again simply reaches the same conclusion.
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
    recurrence_series_id,
    recurrence_anchor_date
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
    v_interval,
    new.recurrence_until,
    new.recurrence_series_id,
    v_anchor
  )
  returning id into v_spawned;

  -- The link names the successor so the browser can show it without a reload,
  -- and so the guard above can tell an open successor from a withdrawn one.
  new.recurrence_spawned_id := v_spawned;
  return new;
end
$$;

revoke all on function private.spawn_recurring_todo()
  from public, anon, authenticated, service_role, orbitos_rpc;

-- Undoing a completion has to leave exactly one occurrence open again, so the
-- successor that completion created is withdrawn with it. A successor the user
-- has already edited is left alone: their change outranks the bookkeeping, and
-- keeping the link means re-completing cannot produce a third occurrence.
--
-- SECURITY DEFINER for the same reason as the spawn: the withdrawal is scoped
-- to the owner of the row the caller just updated under RLS.
create function private.withdraw_recurring_todo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The link itself is kept. It is how the browser names the occurrence that
  -- has just disappeared, and how a later completion tells a withdrawn
  -- successor from one that is still open.
  update public.todos as successor
  set deleted_at = statement_timestamp()
  where successor.id = old.recurrence_spawned_id
    and successor.user_id = old.user_id
    and not successor.completed
    and successor.deleted_at is null
    and successor.updated_at = successor.created_at;

  return null;
end
$$;

revoke all on function private.withdraw_recurring_todo()
  from public, anon, authenticated, service_role, orbitos_rpc;

create trigger todos_sync_recurrence
before insert or update of
  due_date,
  recurrence_freq,
  recurrence_interval,
  recurrence_until,
  recurrence_series_id,
  recurrence_anchor_date
on public.todos
for each row execute function private.sync_todo_recurrence();

create trigger todos_spawn_recurrence
before update on public.todos
for each row
when (
  new.completed
  and not old.completed
  and new.recurrence_freq is not null
  and old.deleted_at is null
  and new.deleted_at is null
)
execute function private.spawn_recurring_todo();

create trigger todos_withdraw_recurrence
after update on public.todos
for each row
when (
  old.completed
  and not new.completed
  and old.recurrence_spawned_id is not null
  and old.deleted_at is null
  and new.deleted_at is null
)
execute function private.withdraw_recurring_todo();

grant insert (recurrence_freq, recurrence_interval, recurrence_until)
  on public.todos to authenticated;
grant update (recurrence_freq, recurrence_interval, recurrence_until)
  on public.todos to authenticated;

notify pgrst, 'reload schema';

end
$migration$;
