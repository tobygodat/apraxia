begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;

select plan(22);

insert into auth.users (id, email)
values ('55555555-5555-4555-8555-555555555555', 'schedule@example.test');

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';

select lives_ok(
  $$
    insert into public.todos (text, due_date, due_time)
    values
      ('Lower', '0001-01-01', '00:00:00'),
      ('Upper', '9999-12-31', '23:59:59.999999'),
      ('Microseconds', '2000-02-29', '12:34:56.123456'),
      ('Inbox', null, null),
      ('Date only', '2026-09-03', null),
      ('Update target', '2026-09-03', '09:15:00.123456')
  $$,
  'authenticated inserts accept date/time boundaries, microseconds, and null schedules'
);

select results_eq(
  $$
    select text, due_date::text, due_time::text
    from public.todos
    where text <> 'Update target'
    order by text
  $$,
  $$
    values
      ('Date only'::text, '2026-09-03'::text, null::text),
      ('Inbox', null, null),
      ('Lower', '0001-01-01', '00:00:00'),
      ('Microseconds', '2000-02-29', '12:34:56.123456'),
      ('Upper', '9999-12-31', '23:59:59.999999')
  $$,
  'valid inserted dates and fractional seconds are preserved exactly'
);

select throws_ok(
  $$insert into public.todos (text, due_date) values ('Invalid', 'infinity')$$,
  '23514', null, 'authenticated inserts reject positive date infinity'
);
select throws_ok(
  $$insert into public.todos (text, due_date) values ('Invalid', '-infinity')$$,
  '23514', null, 'authenticated inserts reject negative date infinity'
);
select throws_ok(
  $$insert into public.todos (text, due_date) values ('Invalid', '0001-12-31 BC')$$,
  '23514', null, 'authenticated inserts reject dates before year 0001 AD'
);
select throws_ok(
  $$insert into public.todos (text, due_date) values ('Invalid', '10000-01-01')$$,
  '23514', null, 'authenticated inserts reject five-digit years'
);
select throws_ok(
  $$
    insert into public.todos (text, due_date, due_time)
    values ('Invalid', '2026-09-03', '24:00:00')
  $$,
  '23514', null, 'authenticated inserts reject end-of-day 24:00'
);
select throws_ok(
  $$
    insert into public.todos (text, due_date, due_time)
    values ('Invalid', '2026-09-03', '23:59:59.9999999')
  $$,
  '23514', null, 'authenticated inserts reject fractions rounded up to 24:00'
);
select throws_ok(
  $$insert into public.todos (text, due_time) values ('Invalid', '12:00:00')$$,
  '23514', null, 'authenticated inserts still reject a time without a date'
);

select results_eq(
  $$
    update public.todos set due_date = '0001-01-01', due_time = '00:00:00'
    where text = 'Update target'
    returning due_date::text, due_time::text
  $$,
  $$values ('0001-01-01'::text, '00:00:00'::text)$$,
  'authenticated updates accept the inclusive lower boundaries'
);
select results_eq(
  $$
    update public.todos set due_date = '9999-12-31', due_time = '23:59:59.999999'
    where text = 'Update target'
    returning due_date::text, due_time::text
  $$,
  $$values ('9999-12-31'::text, '23:59:59.999999'::text)$$,
  'authenticated updates accept the final representable microsecond'
);
select results_eq(
  $$
    update public.todos set due_date = '2000-02-29', due_time = '12:34:56.123456'
    where text = 'Update target'
    returning due_date::text, due_time::text
  $$,
  $$values ('2000-02-29'::text, '12:34:56.123456'::text)$$,
  'authenticated updates preserve fractional seconds without rounding'
);

select throws_ok(
  $$update public.todos set due_date = 'infinity' where text = 'Update target'$$,
  '23514', null, 'authenticated updates reject positive date infinity'
);
select throws_ok(
  $$update public.todos set due_date = '-infinity' where text = 'Update target'$$,
  '23514', null, 'authenticated updates reject negative date infinity'
);
select throws_ok(
  $$update public.todos set due_date = '0001-12-31 BC' where text = 'Update target'$$,
  '23514', null, 'authenticated updates reject dates before year 0001 AD'
);
select throws_ok(
  $$update public.todos set due_date = '10000-01-01' where text = 'Update target'$$,
  '23514', null, 'authenticated updates reject five-digit years'
);
select throws_ok(
  $$update public.todos set due_time = '24:00:00' where text = 'Update target'$$,
  '23514', null, 'authenticated updates reject end-of-day 24:00'
);
select throws_ok(
  $$update public.todos set due_time = '23:59:59.9999999' where text = 'Update target'$$,
  '23514', null, 'authenticated updates reject fractions rounded up to 24:00'
);
select throws_ok(
  $$update public.todos set due_date = null where text = 'Update target'$$,
  '23514', null, 'authenticated updates still reject clearing the date alone'
);
select results_eq(
  $$
    select due_date::text, due_time::text from public.todos
    where text = 'Update target'
  $$,
  $$values ('2000-02-29'::text, '12:34:56.123456'::text)$$,
  'rejected updates leave the original schedule unchanged'
);
select results_eq(
  $$
    update public.todos set due_date = null, due_time = null
    where text = 'Update target'
    returning due_date::text, due_time::text
  $$,
  $$values (null::text, null::text)$$,
  'authenticated updates may clear both date and time together'
);
select results_eq(
  $$
    update public.todos set due_date = '2026-09-03'
    where text = 'Update target'
    returning due_date::text, due_time::text
  $$,
  $$values ('2026-09-03'::text, null::text)$$,
  'authenticated updates may set a date without adding a time'
);

reset role;
select * from finish();
rollback;
