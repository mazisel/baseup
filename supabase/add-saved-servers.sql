-- Saved servers for quick reuse in service launch forms.
-- Secrets are intentionally not stored: only a user-visible label and SSH host/IP.

create table if not exists public.saved_servers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  host text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, host),
  constraint saved_servers_name_length check (char_length(name) between 1 and 100),
  constraint saved_servers_host_length check (char_length(host) between 1 and 253),
  constraint saved_servers_host_safe check (host !~ '[[:space:]/@]')
);

create index if not exists saved_servers_workspace_id_idx on public.saved_servers(workspace_id);
create index if not exists saved_servers_workspace_last_used_idx on public.saved_servers(workspace_id, last_used_at desc);

alter table public.saved_servers enable row level security;

drop policy if exists "workspace members can read saved servers" on public.saved_servers;
create policy "workspace members can read saved servers"
  on public.saved_servers for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace operators can insert saved servers" on public.saved_servers;
create policy "workspace operators can insert saved servers"
  on public.saved_servers for insert
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));

drop policy if exists "workspace operators can update saved servers" on public.saved_servers;
create policy "workspace operators can update saved servers"
  on public.saved_servers for update
  using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));

drop policy if exists "workspace operators can delete saved servers" on public.saved_servers;
create policy "workspace operators can delete saved servers"
  on public.saved_servers for delete
  using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));
