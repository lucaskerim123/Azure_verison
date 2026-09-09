-- OrbitFS Base deployment/install records.
-- Phase 2: track a customer's commercial OrbitFS installation separately from
-- license_installations, which remains the runtime/device lock registry.

create table if not exists public.orbitfs_installations (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  license_binding_id uuid not null references public.license_bindings(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  order_item_id uuid references public.order_items(id) on delete set null,
  component_key text not null default 'orbitfs_base',
  installation_id text not null unique,

  state text not null default 'pending' check (state in (
    'pending','awaiting_supabase','preparing_database','awaiting_vercel',
    'configuring','deploying','ready','updating','failed'
  )),

  supabase_project_ref text,
  supabase_organization_id text,
  supabase_project_name text,
  supabase_region text,
  schema_version text,

  vercel_team_id text,
  vercel_project_id text,
  vercel_project_name text,
  vercel_deployment_id text,
  deployment_url text,
  production_url text,

  release_version text,
  release_id text,
  release_sha256 text,
  release_source_commit text,

  health_status text not null default 'unknown' check (health_status in ('unknown','checking','healthy','degraded','failed')),
  last_health_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (license_binding_id, component_key)
);

create index if not exists orbitfs_installations_user_idx on public.orbitfs_installations(auth_user_id, created_at desc);
create index if not exists orbitfs_installations_binding_idx on public.orbitfs_installations(license_binding_id);
create index if not exists orbitfs_installations_state_idx on public.orbitfs_installations(state, updated_at desc);

alter table public.orbitfs_installations enable row level security;

drop policy if exists "orbitfs installation owner read" on public.orbitfs_installations;
create policy "orbitfs installation owner read"
on public.orbitfs_installations for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists "staff orbitfs installation read" on public.orbitfs_installations;
create policy "staff orbitfs installation read"
on public.orbitfs_installations for select
to authenticated
using (public.has_permission('licenses.view'));

drop policy if exists "staff orbitfs installation update" on public.orbitfs_installations;
create policy "staff orbitfs installation update"
on public.orbitfs_installations for update
to authenticated
using (public.has_permission('licenses.edit'))
with check (public.has_permission('licenses.edit'));

create or replace function public.orbitfs_installations_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orbitfs_installations_touch on public.orbitfs_installations;
create trigger orbitfs_installations_touch
before update on public.orbitfs_installations
for each row execute function public.orbitfs_installations_touch_updated_at();

create or replace function public.ensure_orbitfs_installation(p_binding_id uuid)
returns public.orbitfs_installations
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.license_bindings%rowtype;
  result public.orbitfs_installations%rowtype;
  caller uuid := auth.uid();
  base_allowed boolean := false;
begin
  select * into b
  from public.license_bindings
  where id = p_binding_id and archived_at is null;

  if not found then
    raise exception 'Licence not found';
  end if;

  if caller is null then
    raise exception 'Authentication required';
  end if;

  if b.auth_user_id <> caller and not public.has_permission('licenses.edit') then
    raise exception 'Not allowed to create this OrbitFS installation';
  end if;

  base_allowed :=
    b.license_product_key = 'orbitfs_base'
    or coalesce((b.components->>'orbitfs_base')::boolean, false)
    or coalesce((b.components->>'orbitfs_panel')::boolean, false);

  if not base_allowed then
    raise exception 'This licence does not include OrbitFS Base';
  end if;

  select * into result
  from public.orbitfs_installations
  where license_binding_id = b.id and component_key = 'orbitfs_base';

  if found then
    return result;
  end if;

  insert into public.orbitfs_installations (
    auth_user_id, license_binding_id, order_id, order_item_id,
    component_key, installation_id, state
  ) values (
    b.auth_user_id, b.id, b.order_id, b.order_item_id,
    'orbitfs_base', 'ofs_' || replace(gen_random_uuid()::text, '-', ''), 'pending'
  )
  returning * into result;

  return result;
end;
$$;

revoke all on function public.ensure_orbitfs_installation(uuid) from public;
grant execute on function public.ensure_orbitfs_installation(uuid) to authenticated;
