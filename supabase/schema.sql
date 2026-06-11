-- Supabase Migration SaaS control-plane schema.
-- Secrets are intentionally not stored. Job inputs must be sanitized before insert.

create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.entitlements (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan text not null default 'trial' check (plan in ('trial', 'growth', 'scale')),
  monthly_job_limit integer not null default 10,
  parallel_job_limit integer not null default 1,
  legacy_bridge_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  type text not null,
  title text not null,
  status text not null check (status in ('queued', 'running', 'success', 'error', 'cancelled')),
  sanitized_summary jsonb not null default '{}'::jsonb,
  error_message text,
  usage_units integer not null default 1,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.job_runs(id) on delete cascade,
  level text not null check (level in ('info', 'warn', 'error', 'success', 'step')),
  message text not null,
  created_at timestamptz not null default now()
);

-- Admin-managed pricing packages
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,             -- 'growth', 'scale', 'enterprise'
  name text not null,                     -- 'Growth Paketi'
  description text not null default '',
  price_kurus integer not null default 0, -- Kuruş cinsinden (99900 = 999 TL)
  currency text not null default 'TL',
  billing_period text not null default 'monthly' check (billing_period in ('monthly', 'yearly', 'one_time')),
  plan_id text not null default 'growth', -- Hangi plana eşitlenecek (trial, growth, scale)
  monthly_job_limit integer not null default 50,
  parallel_job_limit integer not null default 2,
  features jsonb not null default '[]'::jsonb, -- ["Sınırsız takım üyesi", "Öncelikli destek"]
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Admin-managed discount coupons
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value integer not null, -- Yüzde ise 1-100, Sabit ise kuruş cinsinden
  max_uses integer, -- Null ise sınırsız
  used_count integer not null default 0,
  expires_at timestamptz, -- Null ise süresiz
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.entitlements enable row level security;
alter table public.job_runs enable row level security;
alter table public.job_events enable row level security;
alter table public.packages enable row level security;
alter table public.coupons enable row level security;

-- Coupons are readable by everyone (to validate them), writable only via service_role
create policy "anyone can read active coupons"
  on public.coupons for select
  using (is_active = true);

-- Packages are readable by everyone (pricing page), writable only via service_role (admin API)
create policy "anyone can read active packages"
  on public.packages for select
  using (is_active = true);

create policy "workspace members can read workspaces"
  on public.workspaces for select
  using (exists (
    select 1 from public.memberships m
    where m.workspace_id = id and m.user_id = auth.uid()
  ));

create policy "workspace members can read memberships"
  on public.memberships for select
  using (user_id = auth.uid() or exists (
    select 1 from public.memberships m
    where m.workspace_id = memberships.workspace_id and m.user_id = auth.uid()
  ));

create policy "workspace admins can insert memberships"
  on public.memberships for insert
  with check (exists (
    select 1 from public.memberships m
    where m.workspace_id = workspace_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));

create policy "workspace admins can update memberships"
  on public.memberships for update
  using (exists (
    select 1 from public.memberships m
    where m.workspace_id = memberships.workspace_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));

create policy "workspace admins can delete memberships"
  on public.memberships for delete
  using (exists (
    select 1 from public.memberships m
    where m.workspace_id = memberships.workspace_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));

create policy "workspace members can read entitlements"
  on public.entitlements for select
  using (exists (
    select 1 from public.memberships m
    where m.workspace_id = entitlements.workspace_id and m.user_id = auth.uid()
  ));

create policy "workspace members can read jobs"
  on public.job_runs for select
  using (exists (
    select 1 from public.memberships m
    where m.workspace_id = job_runs.workspace_id and m.user_id = auth.uid()
  ));

create policy "workspace operators can create jobs"
  on public.job_runs for insert
  with check (exists (
    select 1 from public.memberships m
    where m.workspace_id = job_runs.workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'operator')
  ));

create policy "workspace members can read job events"
  on public.job_events for select
  using (exists (
    select 1
    from public.job_runs j
    join public.memberships m on m.workspace_id = j.workspace_id
    where j.id = job_events.job_id and m.user_id = auth.uid()
  ));

-- ==========================================
-- Health Monitoring (V2 Feature)
-- ==========================================

create table if not exists public.health_monitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  url text not null,
  status text not null default 'pending' check (status in ('pending', 'up', 'down', 'paused')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.health_events (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.health_monitors(id) on delete cascade,
  status text not null check (status in ('up', 'down')),
  response_time_ms integer,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.health_monitors enable row level security;
alter table public.health_events enable row level security;

create policy "workspace members can read monitors"
  on public.health_monitors for select
  using (exists (
    select 1 from public.memberships m
    where m.workspace_id = health_monitors.workspace_id and m.user_id = auth.uid()
  ));

create policy "workspace operators can insert monitors"
  on public.health_monitors for insert
  with check (exists (
    select 1 from public.memberships m
    where m.workspace_id = health_monitors.workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'operator')
  ));

create policy "workspace operators can delete monitors"
  on public.health_monitors for delete
  using (exists (
    select 1 from public.memberships m
    where m.workspace_id = health_monitors.workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'operator')
  ));

create policy "workspace members can read health events"
  on public.health_events for select
  using (exists (
    select 1 from public.health_monitors hm
    join public.memberships m on m.workspace_id = hm.workspace_id
    where hm.id = health_events.monitor_id and m.user_id = auth.uid()
  ));

-- ==========================================
-- Team Collaboration (V2 Feature)
-- ==========================================

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

alter table public.workspace_invitations enable row level security;

create policy "workspace operators can view invitations"
  on public.workspace_invitations for select
  using (exists (
    select 1 from public.memberships m
    where m.workspace_id = workspace_invitations.workspace_id
      and m.user_id = auth.uid()
  ));

create policy "workspace operators can insert invitations"
  on public.workspace_invitations for insert
  with check (exists (
    select 1 from public.memberships m
    where m.workspace_id = workspace_invitations.workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  ));

create policy "workspace operators can delete invitations"
  on public.workspace_invitations for delete
  using (exists (
    select 1 from public.memberships m
    where m.workspace_id = workspace_invitations.workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  ));

-- ==========================================
-- Triggers for automatic workspace creation
-- ==========================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_workspace_id uuid;
  invitation record;
begin
  -- Check if user has pending invitations
  for invitation in select * from public.workspace_invitations where email = new.email loop
    insert into public.memberships (workspace_id, user_id, role)
    values (invitation.workspace_id, new.id, invitation.role)
    on conflict do nothing;

    delete from public.workspace_invitations where id = invitation.id;
  end loop;

  -- Create a personal workspace for them anyway, so they always have one they own
  insert into public.workspaces (name, slug)
  values (
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)) || '-' || substr(md5(random()::text), 1, 6)
  )
  returning id into new_workspace_id;

  insert into public.memberships (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  insert into public.entitlements (workspace_id, plan)
  values (new_workspace_id, 'trial');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
