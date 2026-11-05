-- 僅供本機測試：重現 Supabase 預先建好的角色、auth 與 storage 結構。
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit;
create role postgres login createrole;
grant anon, authenticated, service_role to postgres;

create schema auth authorization postgres;
create schema storage authorization postgres;
grant usage on schema auth, storage to anon, authenticated, service_role;

create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
alter table auth.users owner to postgres;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
$$;
alter function auth.uid() owner to postgres;

create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  unique (bucket_id, name)
);
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to anon, authenticated;

-- 測試用資料庫 public schema 預設不給 postgres 建立權限，這裡補上（Supabase 上本來就有）。
alter schema public owner to postgres;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;
