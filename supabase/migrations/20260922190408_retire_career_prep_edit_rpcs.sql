-- Career edits and removes a prep action through the writes Tasks already uses:
-- a browser update of public.todos, or soft_delete_record('todo', ...). The
-- todos_sync_career_prep trigger from 20260922062559_canonical_career_prep_todos
-- mirrors either into career_prep, so that migration's two Career-only write
-- RPCs duplicated an existing path. Apply this only after the frontend that no
-- longer calls them is deployed; until then the deployed page still calls them.
do $migration$
begin

-- Dropping a helper requires membership in its owner role; repeat the
-- temporary setup that created it.
grant orbitos_rpc to postgres;

drop function public.save_career_prep_item(uuid, jsonb);
drop function public.remove_career_prep_item(uuid);
drop function internal.save_career_prep_item(uuid, jsonb);
drop function internal.remove_career_prep_item(uuid);

-- Only the edit helper updated rows as orbitos_rpc. The import helper still
-- inserts into both tables, and the soft-delete helpers keep the
-- (deleted_at, today_rank) grant from the initial schema.
drop policy career_prep_rpc_update_own on public.career_prep;
revoke update (position) on public.career_prep from orbitos_rpc;
revoke update (
  text, completed, due_date, due_time, recurrence_freq, recurrence_interval,
  recurrence_until
) on public.todos from orbitos_rpc;

revoke orbitos_rpc from postgres;

notify pgrst, 'reload schema';

end
$migration$;
