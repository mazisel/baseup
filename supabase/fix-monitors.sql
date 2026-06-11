begin;

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

drop policy if exists "workspace members can read monitors" on public.health_monitors;
drop policy if exists "workspace operators can insert monitors" on public.health_monitors;
drop policy if exists "workspace operators can delete monitors" on public.health_monitors;
drop policy if exists "workspace members can read health events" on public.health_events;

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

commit;
