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

drop policy if exists "workspace members can read workspaces" on public.workspaces;
drop policy if exists "workspace members can read memberships" on public.memberships;
drop policy if exists "workspace admins can insert memberships" on public.memberships;
drop policy if exists "workspace admins can update memberships" on public.memberships;
drop policy if exists "workspace admins can delete memberships" on public.memberships;
drop policy if exists "workspace members can read entitlements" on public.entitlements;
drop policy if exists "workspace members can read jobs" on public.job_runs;
drop policy if exists "workspace operators can create jobs" on public.job_runs;
drop policy if exists "workspace members can read job events" on public.job_events;
drop policy if exists "workspace members can read monitors" on public.health_monitors;
drop policy if exists "workspace operators can insert monitors" on public.health_monitors;
drop policy if exists "workspace operators can delete monitors" on public.health_monitors;
drop policy if exists "workspace members can read health events" on public.health_events;
drop policy if exists "workspace operators can view invitations" on public.workspace_invitations;
drop policy if exists "workspace operators can insert invitations" on public.workspace_invitations;
drop policy if exists "workspace operators can delete invitations" on public.workspace_invitations;

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

create policy "workspace operators can view invitations"
  on public.workspace_invitations for select
  using (public.is_workspace_member(workspace_id));

create policy "workspace operators can insert invitations"
  on public.workspace_invitations for insert
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "workspace operators can delete invitations"
  on public.workspace_invitations for delete
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

commit;
