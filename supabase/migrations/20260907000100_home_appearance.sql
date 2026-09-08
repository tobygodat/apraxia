-- Small, account-owned presentation preferences. Covers are resized by the client
-- and bounded here; no public image bucket or changes to existing records.
create table public.home_appearance (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 100),
  cover_image text check (
    cover_image is null or (
      octet_length(cover_image) <= 350000 and
      cover_image ~ '^data:image/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'
    )
  )
);
alter table public.home_appearance enable row level security;
revoke all on public.home_appearance from anon, authenticated;
grant select, insert, update on public.home_appearance to authenticated;
create policy home_appearance_select_own on public.home_appearance for select to authenticated
  using ((select auth.uid()) = user_id);
create policy home_appearance_insert_own on public.home_appearance for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy home_appearance_update_own on public.home_appearance for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
