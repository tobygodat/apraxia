-- Keep persisted schedules representable by the shared browser domain.
-- Validate existing rows; do not silently rewrite dates, times, or fractions.
-- A pre-existing out-of-range row (including a soft-deleted row) must be
-- reviewed and explicitly corrected before this migration can succeed.

alter table public.todos
  add constraint todos_due_date_app_range check (
    due_date is null
    or due_date between date '0001-01-01' and date '9999-12-31'
  ),
  add constraint todos_due_time_app_range check (
    due_time is null
    or (
      due_time >= time '00:00:00'
      and due_time < time '24:00:00'
    )
  );
