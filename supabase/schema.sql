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

-- Admin-managed system plans / pricing packages
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,             -- System plan code: 'basic', 'growth', 'scale'
  name text not null,                     -- 'Basic'
  description text not null default '',
  price_kurus integer not null default 0, -- Minor currency unit (USD cents, e.g. 2900 = $29.00)
  currency text not null default 'USD',
  billing_period text not null default 'monthly' check (billing_period in ('monthly', 'yearly', 'one_time')),
  plan_id text not null default 'basic', -- Usually matches slug; stored in entitlements.plan
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
  discount_value integer not null, -- Percentage: 1-100, fixed amount: USD cents
  max_uses integer, -- Null ise sınırsız
  used_count integer not null default 0,
  expires_at timestamptz, -- Null ise süresiz
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- PayTR payment orders: merchant_oid must be alphanumeric, so order metadata
-- (workspace/package/coupon) is stored here instead of being encoded in the oid.
create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  merchant_oid text not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  package_id uuid not null references public.packages(id) on delete restrict,
  coupon_code text,
  amount_kurus integer not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists payment_orders_workspace_idx on public.payment_orders(workspace_id);

alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.entitlements enable row level security;
alter table public.job_runs enable row level security;
alter table public.job_events enable row level security;
alter table public.packages enable row level security;
alter table public.coupons enable row level security;
-- payment_orders: no policies on purpose; only the service role (token/callback routes) touches it.
alter table public.payment_orders enable row level security;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.memberships m
    where m.workspace_id = target_workspace_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_workspace_role(target_workspace_id uuid, allowed_roles text[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.memberships m
    where m.workspace_id = target_workspace_id
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$$;

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
  using (public.is_workspace_member(id));

create policy "workspace members can read memberships"
  on public.memberships for select
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

create policy "workspace admins can insert memberships"
  on public.memberships for insert
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "workspace admins can update memberships"
  on public.memberships for update
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "workspace admins can delete memberships"
  on public.memberships for delete
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "workspace members can read entitlements"
  on public.entitlements for select
  using (public.is_workspace_member(workspace_id));

create policy "workspace members can read jobs"
  on public.job_runs for select
  using (public.is_workspace_member(workspace_id));

create policy "workspace operators can create jobs"
  on public.job_runs for insert
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));

create policy "workspace members can read job events"
  on public.job_events for select
  using (exists (
    select 1
    from public.job_runs j
    where j.id = job_events.job_id
      and public.is_workspace_member(j.workspace_id)
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

create index if not exists health_monitors_workspace_id_idx on public.health_monitors(workspace_id);
create index if not exists health_events_monitor_id_created_at_idx on public.health_events(monitor_id, created_at desc);

alter table public.health_monitors enable row level security;
alter table public.health_events enable row level security;

create policy "workspace members can read monitors"
  on public.health_monitors for select
  using (public.is_workspace_member(workspace_id));

create policy "workspace operators can insert monitors"
  on public.health_monitors for insert
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));

create policy "workspace operators can delete monitors"
  on public.health_monitors for delete
  using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));

create policy "workspace members can read health events"
  on public.health_events for select
  using (exists (
    select 1
    from public.health_monitors hm
    where hm.id = health_events.monitor_id
      and public.is_workspace_member(hm.workspace_id)
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
  using (public.is_workspace_member(workspace_id));

create policy "workspace operators can insert invitations"
  on public.workspace_invitations for insert
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "workspace operators can delete invitations"
  on public.workspace_invitations for delete
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

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
