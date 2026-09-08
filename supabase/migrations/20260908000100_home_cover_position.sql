-- Preserve existing covers and center their crop until the owner changes it.
alter table public.home_appearance
  add column cover_position_x smallint not null default 50 check (cover_position_x between 0 and 100),
  add column cover_position_y smallint not null default 50 check (cover_position_y between 0 and 100);
