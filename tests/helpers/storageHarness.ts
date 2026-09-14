// Minimal Storage catalog for embedded SQL tests. Actual Storage HTTP behavior
// still requires Supabase; this harness exercises policies and finalization.
export const storageHarnessSql = `
  create schema storage;
  create table storage.buckets(id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text not null, metadata jsonb, unique(bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated, anon, service_role;
  grant select, insert, update, delete on storage.objects to authenticated;
`;
