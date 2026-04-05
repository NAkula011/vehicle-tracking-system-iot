

create extension if not exists pgcrypto;


create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  device_uid text not null unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text,
  status text not null default 'offline' check (status in ('online', 'offline', 'unknown')),
  last_seen timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table if not exists public.device_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  command text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'acknowledged', 'failed', 'timeout')),
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  ack_at timestamptz
);

-- locations table: saved user locations (home / POI)
CREATE TABLE IF NOT EXISTS public.locations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  tenant_id uuid NULL,
  label text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  type text NOT NULL DEFAULT 'other',
  is_home boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS locations_user_id_idx ON public.locations(user_id);
CREATE INDEX IF NOT EXISTS locations_tenant_id_idx ON public.locations(tenant_id);

-- ------------------------------------------------------------
-- Backward-compatible column migrations (for existing projects)
-- ------------------------------------------------------------

alter table if exists public.profiles
  add column if not exists tenant_id uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.devices
  add column if not exists tenant_id uuid,
  add column if not exists label text,
  add column if not exists status text default 'offline',
  add column if not exists last_seen timestamptz,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.user_devices
  add column if not exists role text default 'viewer',
  add column if not exists created_at timestamptz default now();

alter table if exists public.device_events
  add column if not exists type text,
  add column if not exists payload jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now();

alter table if exists public.commands
  add column if not exists status text default 'queued',
  add column if not exists requested_by uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists ack_at timestamptz;

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------

create index if not exists idx_profiles_tenant_id on public.profiles(tenant_id);
create index if not exists idx_devices_tenant_id on public.devices(tenant_id);
create index if not exists idx_devices_status_last_seen on public.devices(status, last_seen desc);
create index if not exists idx_user_devices_user_id on public.user_devices(user_id);
create index if not exists idx_user_devices_device_id on public.user_devices(device_id);
create index if not exists idx_device_events_device_created on public.device_events(device_id, created_at desc);
create index if not exists idx_commands_device_created on public.commands(device_id, created_at desc);
create index if not exists idx_commands_requested_by on public.commands(requested_by, created_at desc);

-- ------------------------------------------------------------
-- Utility triggers
-- ------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_devices_updated_at on public.devices;
create trigger trg_devices_updated_at
before update on public.devices
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_uuid uuid;
begin
  insert into public.tenants(name)
  values (
    coalesce(
      nullif(new.raw_user_meta_data->>'product_name', ''),
      nullif(new.raw_user_meta_data->>'company_name', ''),
      split_part(new.email, '@', 1) || '-tenant'
    )
  )
  returning id into tenant_uuid;

  insert into public.profiles(id, email, full_name, tenant_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    tenant_uuid
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.user_devices enable row level security;
alter table public.device_events enable row level security;
alter table public.commands enable row level security;

-- tenants
drop policy if exists tenants_select_own on public.tenants;
create policy tenants_select_own
on public.tenants
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.tenant_id = tenants.id
  )
);

-- profiles
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
using (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

-- user_devices
drop policy if exists user_devices_select_self on public.user_devices;
create policy user_devices_select_self
on public.user_devices
for select
using (user_id = auth.uid());

-- devices: only mapped devices
drop policy if exists devices_select_mapped on public.devices;
create policy devices_select_mapped
on public.devices
for select
using (
  exists (
    select 1
    from public.user_devices ud
    where ud.device_id = devices.id
      and ud.user_id = auth.uid()
  )
);

-- commands: read own mapped devices
drop policy if exists commands_select_mapped on public.commands;
create policy commands_select_mapped
on public.commands
for select
using (
  exists (
    select 1
    from public.user_devices ud
    where ud.device_id = commands.device_id
      and ud.user_id = auth.uid()
  )
);

-- commands: insert for own mapped devices only
drop policy if exists commands_insert_mapped on public.commands;
create policy commands_insert_mapped
on public.commands
for insert
with check (
  requested_by = auth.uid()
  and exists (
    select 1
    from public.user_devices ud
    where ud.device_id = commands.device_id
      and ud.user_id = auth.uid()
      and ud.role in ('owner', 'operator')
  )
);

-- device_events: read own mapped devices
drop policy if exists device_events_select_mapped on public.device_events;
create policy device_events_select_mapped
on public.device_events
for select
using (
  exists (
    select 1
    from public.user_devices ud
    where ud.device_id = device_events.device_id
      and ud.user_id = auth.uid()
  )
);

-- ------------------------------------------------------------
-- Realtime publication (optional but recommended)
-- ------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'device_events'
  ) then
    alter publication supabase_realtime add table public.device_events;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'commands'
  ) then
    alter publication supabase_realtime add table public.commands;
  end if;
end
$$;
