-- OrbitFS customer deployment control plane: provider connections, release controls,
-- deployment history and secure Vault-backed credentials.
-- Public installation rows intentionally contain no OAuth tokens, DB passwords or DB secrets.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.orbitfs_installations
  add column if not exists database_initialized_at timestamptz,
  add column if not exists last_deployment_at timestamptz,
  add column if not exists previous_release_version text,
  add column if not exists latest_available_release text;

create table if not exists public.orbitfs_release_system_settings (
  id text primary key default 'primary' check (id='primary'),
  enabled boolean not null default false,
  customer_deploy_enabled boolean not null default false,
  customer_updates_enabled boolean not null default false,
  customer_rollbacks_enabled boolean not null default false,
  allow_existing_supabase_project boolean not null default true,
  allow_create_supabase_project boolean not null default true,
  supabase_oauth_enabled boolean not null default true,
  vercel_oauth_enabled boolean not null default true,
  supabase_client_id text,
  vercel_client_id text,
  vercel_install_url text,
  supabase_scopes text not null default 'organizations:read projects:read projects:write database:write secrets:read secrets:write',
  default_supabase_region text not null default 'ap-southeast-2',
  panel_project_prefix text not null default 'orbitfs-panel',
  schema_version text not null default '1',
  schema_bucket text not null default 'orbitfs-installer-assets',
  schema_path text not null default 'base/schema.sql',
  health_path text not null default '/',
  release_channel text not null default 'latest',
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.orbitfs_release_system_settings(id) values('primary') on conflict (id) do nothing;
alter table public.orbitfs_release_system_settings enable row level security;
drop policy if exists "staff release system read" on public.orbitfs_release_system_settings;
create policy "staff release system read" on public.orbitfs_release_system_settings for select to authenticated
using (public.has_permission('licenses.view'));

create table if not exists private.orbitfs_release_secret_refs (
  key text primary key,
  secret_id uuid not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.orbitfs_provider_connections (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('supabase','vercel')),
  status text not null default 'connected' check (status in ('connected','expired','revoked','error')),
  provider_account_id text,
  provider_account_name text,
  team_id text,
  scopes jsonb not null default '[]'::jsonb,
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  refreshed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(auth_user_id,provider)
);
alter table public.orbitfs_provider_connections enable row level security;
drop policy if exists "owner provider connection read" on public.orbitfs_provider_connections;
create policy "owner provider connection read" on public.orbitfs_provider_connections for select to authenticated
using (auth_user_id=auth.uid());
drop policy if exists "staff provider connection read" on public.orbitfs_provider_connections;
create policy "staff provider connection read" on public.orbitfs_provider_connections for select to authenticated
using (public.has_permission('licenses.view'));

create table if not exists private.orbitfs_provider_connection_secrets (
  connection_id uuid primary key references public.orbitfs_provider_connections(id) on delete cascade,
  access_token_secret_id uuid,
  refresh_token_secret_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists private.orbitfs_installation_secret_refs (
  installation_id uuid primary key references public.orbitfs_installations(id) on delete cascade,
  secret_refs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.orbitfs_oauth_states (
  state_hash text primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid references public.orbitfs_installations(id) on delete cascade,
  provider text not null check (provider in ('supabase','vercel')),
  return_path text not null default '/portal/orbitfs',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.orbitfs_oauth_states enable row level security;

create table if not exists public.orbitfs_deployment_events (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.orbitfs_installations(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  status text not null default 'info',
  message text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists orbitfs_deployment_events_install_idx on public.orbitfs_deployment_events(installation_id,created_at desc);
alter table public.orbitfs_deployment_events enable row level security;
drop policy if exists "owner deployment events read" on public.orbitfs_deployment_events;
create policy "owner deployment events read" on public.orbitfs_deployment_events for select to authenticated
using (auth_user_id=auth.uid());
drop policy if exists "staff deployment events read" on public.orbitfs_deployment_events;
create policy "staff deployment events read" on public.orbitfs_deployment_events for select to authenticated
using (public.has_permission('licenses.view'));

create table if not exists public.orbitfs_installation_releases (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.orbitfs_installations(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  release_version text not null,
  release_id text,
  release_sha256 text,
  source_commit text,
  vercel_deployment_id text,
  deployment_url text,
  action text not null default 'deploy' check (action in ('deploy','update','rollback','redeploy')),
  status text not null default 'started' check (status in ('started','ready','failed')),
  created_at timestamptz not null default now(),
  ready_at timestamptz
);
create index if not exists orbitfs_installation_releases_install_idx on public.orbitfs_installation_releases(installation_id,created_at desc);
alter table public.orbitfs_installation_releases enable row level security;
drop policy if exists "owner installation releases read" on public.orbitfs_installation_releases;
create policy "owner installation releases read" on public.orbitfs_installation_releases for select to authenticated
using (auth_user_id=auth.uid());
drop policy if exists "staff installation releases read" on public.orbitfs_installation_releases;
create policy "staff installation releases read" on public.orbitfs_installation_releases for select to authenticated
using (public.has_permission('licenses.view'));

create or replace function public.admin_orbitfs_release_system_snapshot()
returns jsonb language sql security definer set search_path=public,private as $$
select case when public.has_permission('licenses.view') then
  jsonb_build_object(
    'settings',to_jsonb(s),
    'supabase_client_secret_configured',exists(select 1 from private.orbitfs_release_secret_refs where key='supabase_client_secret'),
    'vercel_client_secret_configured',exists(select 1 from private.orbitfs_release_secret_refs where key='vercel_client_secret'),
    'installations',(select count(*) from public.orbitfs_installations),
    'connected_supabase',(select count(*) from public.orbitfs_provider_connections where provider='supabase' and status='connected'),
    'connected_vercel',(select count(*) from public.orbitfs_provider_connections where provider='vercel' and status='connected')
  ) else '{}'::jsonb end
from public.orbitfs_release_system_settings s where s.id='primary';
$$;
revoke all on function public.admin_orbitfs_release_system_snapshot() from public;
grant execute on function public.admin_orbitfs_release_system_snapshot() to authenticated;

create or replace function public.admin_update_orbitfs_release_system(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare outrow public.orbitfs_release_system_settings%rowtype;
begin
  if not (public.has_permission('licenses.manage') or public.has_permission('licenses.edit') or public.has_permission('license_api.manage')) then raise exception 'permission denied'; end if;
  update public.orbitfs_release_system_settings set
    enabled=case when p_patch?'enabled' then (p_patch->>'enabled')::boolean else enabled end,
    customer_deploy_enabled=case when p_patch?'customer_deploy_enabled' then (p_patch->>'customer_deploy_enabled')::boolean else customer_deploy_enabled end,
    customer_updates_enabled=case when p_patch?'customer_updates_enabled' then (p_patch->>'customer_updates_enabled')::boolean else customer_updates_enabled end,
    customer_rollbacks_enabled=case when p_patch?'customer_rollbacks_enabled' then (p_patch->>'customer_rollbacks_enabled')::boolean else customer_rollbacks_enabled end,
    allow_existing_supabase_project=case when p_patch?'allow_existing_supabase_project' then (p_patch->>'allow_existing_supabase_project')::boolean else allow_existing_supabase_project end,
    allow_create_supabase_project=case when p_patch?'allow_create_supabase_project' then (p_patch->>'allow_create_supabase_project')::boolean else allow_create_supabase_project end,
    supabase_oauth_enabled=case when p_patch?'supabase_oauth_enabled' then (p_patch->>'supabase_oauth_enabled')::boolean else supabase_oauth_enabled end,
    vercel_oauth_enabled=case when p_patch?'vercel_oauth_enabled' then (p_patch->>'vercel_oauth_enabled')::boolean else vercel_oauth_enabled end,
    supabase_client_id=case when p_patch?'supabase_client_id' then nullif(btrim(p_patch->>'supabase_client_id'),'') else supabase_client_id end,
    vercel_client_id=case when p_patch?'vercel_client_id' then nullif(btrim(p_patch->>'vercel_client_id'),'') else vercel_client_id end,
    vercel_install_url=case when p_patch?'vercel_install_url' then nullif(btrim(p_patch->>'vercel_install_url'),'') else vercel_install_url end,
    supabase_scopes=case when p_patch?'supabase_scopes' then coalesce(nullif(btrim(p_patch->>'supabase_scopes'),''),supabase_scopes) else supabase_scopes end,
    default_supabase_region=case when p_patch?'default_supabase_region' then coalesce(nullif(btrim(p_patch->>'default_supabase_region'),''),default_supabase_region) else default_supabase_region end,
    panel_project_prefix=case when p_patch?'panel_project_prefix' then coalesce(nullif(btrim(p_patch->>'panel_project_prefix'),''),panel_project_prefix) else panel_project_prefix end,
    schema_version=case when p_patch?'schema_version' then coalesce(nullif(btrim(p_patch->>'schema_version'),''),schema_version) else schema_version end,
    schema_bucket=case when p_patch?'schema_bucket' then coalesce(nullif(btrim(p_patch->>'schema_bucket'),''),schema_bucket) else schema_bucket end,
    schema_path=case when p_patch?'schema_path' then coalesce(nullif(btrim(p_patch->>'schema_path'),''),schema_path) else schema_path end,
    health_path=case when p_patch?'health_path' then coalesce(nullif(btrim(p_patch->>'health_path'),''),health_path) else health_path end,
    release_channel=case when p_patch?'release_channel' then coalesce(nullif(btrim(p_patch->>'release_channel'),''),release_channel) else release_channel end,
    metadata=case when p_patch?'metadata' and jsonb_typeof(p_patch->'metadata')='object' then p_patch->'metadata' else metadata end,
    updated_by=auth.uid(), updated_at=now()
  where id='primary' returning * into outrow;
  return to_jsonb(outrow);
end $$;
revoke all on function public.admin_update_orbitfs_release_system(jsonb) from public;
grant execute on function public.admin_update_orbitfs_release_system(jsonb) to authenticated;

create or replace function public.admin_store_orbitfs_release_secret(p_key text,p_value text)
returns jsonb language plpgsql security definer set search_path=public,private,vault as $$
declare sid uuid;
begin
  if not (public.has_permission('licenses.manage') or public.has_permission('license_api.manage')) then raise exception 'permission denied'; end if;
  if p_key not in ('supabase_client_secret','vercel_client_secret') then raise exception 'unsupported secret'; end if;
  if nullif(btrim(coalesce(p_value,'')),'') is null then raise exception 'secret value required'; end if;
  select secret_id into sid from private.orbitfs_release_secret_refs where key=p_key for update;
  if sid is null then sid:=vault.create_secret(p_value,'orbitfs_release_'||p_key,'OrbitFS release system credential',null);
  else perform vault.update_secret(sid,p_value,'orbitfs_release_'||p_key,'OrbitFS release system credential',null); end if;
  insert into private.orbitfs_release_secret_refs(key,secret_id,updated_at) values(p_key,sid,now())
  on conflict(key) do update set secret_id=excluded.secret_id,updated_at=now();
  return jsonb_build_object('ok',true,'key',p_key,'configured',true);
end $$;
revoke all on function public.admin_store_orbitfs_release_secret(text,text) from public;
grant execute on function public.admin_store_orbitfs_release_secret(text,text) to authenticated;

create or replace function public.admin_remove_orbitfs_release_secret(p_key text)
returns jsonb language plpgsql security definer set search_path=public,private as $$
begin
  if not (public.has_permission('licenses.manage') or public.has_permission('license_api.manage')) then raise exception 'permission denied'; end if;
  delete from private.orbitfs_release_secret_refs where key=p_key;
  return jsonb_build_object('ok',true,'key',p_key,'configured',false);
end $$;
revoke all on function public.admin_remove_orbitfs_release_secret(text) from public;
grant execute on function public.admin_remove_orbitfs_release_secret(text) to authenticated;

create or replace function public.service_orbitfs_release_secret(p_key text)
returns text language plpgsql security definer set search_path=public,private,vault as $$
declare sid uuid; val text;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  select secret_id into sid from private.orbitfs_release_secret_refs where key=p_key;
  if sid is null then return null; end if;
  select decrypted_secret into val from vault.decrypted_secrets where id=sid;
  return val;
end $$;

create or replace function public.service_upsert_orbitfs_provider_connection(
  p_user_id uuid,p_provider text,p_access_token text,p_refresh_token text,p_expires_at timestamptz,p_metadata jsonb default '{}'::jsonb
) returns public.orbitfs_provider_connections language plpgsql security definer set search_path=public,private,vault as $$
declare cid uuid; a uuid; r uuid; outrow public.orbitfs_provider_connections%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  if p_provider not in ('supabase','vercel') then raise exception 'unsupported provider'; end if;
  insert into public.orbitfs_provider_connections(auth_user_id,provider,status,provider_account_id,provider_account_name,team_id,scopes,token_expires_at,metadata,refreshed_at,updated_at)
  values(p_user_id,p_provider,'connected',p_metadata->>'provider_account_id',p_metadata->>'provider_account_name',p_metadata->>'team_id',coalesce(p_metadata->'scopes','[]'::jsonb),p_expires_at,coalesce(p_metadata,'{}'::jsonb),now(),now())
  on conflict(auth_user_id,provider) do update set status='connected',provider_account_id=excluded.provider_account_id,provider_account_name=excluded.provider_account_name,team_id=excluded.team_id,scopes=excluded.scopes,token_expires_at=excluded.token_expires_at,metadata=excluded.metadata,refreshed_at=now(),last_error=null,updated_at=now()
  returning * into outrow; cid:=outrow.id;
  insert into private.orbitfs_provider_connection_secrets(connection_id) values(cid) on conflict(connection_id) do nothing;
  select access_token_secret_id,refresh_token_secret_id into a,r from private.orbitfs_provider_connection_secrets where connection_id=cid for update;
  if nullif(p_access_token,'') is not null then
    if a is null then a:=vault.create_secret(p_access_token,'orbitfs_'||p_provider||'_'||cid::text||'_access','OrbitFS provider access token',null);
    else perform vault.update_secret(a,p_access_token,'orbitfs_'||p_provider||'_'||cid::text||'_access','OrbitFS provider access token',null); end if;
  end if;
  if nullif(p_refresh_token,'') is not null then
    if r is null then r:=vault.create_secret(p_refresh_token,'orbitfs_'||p_provider||'_'||cid::text||'_refresh','OrbitFS provider refresh token',null);
    else perform vault.update_secret(r,p_refresh_token,'orbitfs_'||p_provider||'_'||cid::text||'_refresh','OrbitFS provider refresh token',null); end if;
  end if;
  update private.orbitfs_provider_connection_secrets set access_token_secret_id=a,refresh_token_secret_id=r,updated_at=now() where connection_id=cid;
  return outrow;
end $$;

create or replace function public.service_orbitfs_provider_secret(p_user_id uuid,p_provider text,p_key text)
returns text language plpgsql security definer set search_path=public,private,vault as $$
declare sid uuid; val text;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  select case when p_key='access_token' then s.access_token_secret_id when p_key='refresh_token' then s.refresh_token_secret_id else null end into sid
  from private.orbitfs_provider_connection_secrets s join public.orbitfs_provider_connections c on c.id=s.connection_id
  where c.auth_user_id=p_user_id and c.provider=p_provider;
  if sid is null then return null; end if;
  select decrypted_secret into val from vault.decrypted_secrets where id=sid;
  return val;
end $$;

create or replace function public.service_store_orbitfs_installation_secret(p_installation_id uuid,p_key text,p_value text)
returns boolean language plpgsql security definer set search_path=public,private,vault as $$
declare refs jsonb; sid uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  if p_key not in ('db_secret','db_password') then raise exception 'unsupported installation secret'; end if;
  if nullif(p_value,'') is null then raise exception 'secret value required'; end if;
  insert into private.orbitfs_installation_secret_refs(installation_id) values(p_installation_id) on conflict(installation_id) do nothing;
  select secret_refs into refs from private.orbitfs_installation_secret_refs where installation_id=p_installation_id for update;
  sid:=nullif(refs->>p_key,'')::uuid;
  if sid is null then sid:=vault.create_secret(p_value,'orbitfs_install_'||p_installation_id::text||'_'||p_key,'OrbitFS installation secret',null);
  else perform vault.update_secret(sid,p_value,'orbitfs_install_'||p_installation_id::text||'_'||p_key,'OrbitFS installation secret',null); end if;
  update private.orbitfs_installation_secret_refs set secret_refs=jsonb_set(coalesce(secret_refs,'{}'::jsonb),array[p_key],to_jsonb(sid::text),true),updated_at=now() where installation_id=p_installation_id;
  return true;
end $$;

create or replace function public.service_orbitfs_installation_secret(p_installation_id uuid,p_key text)
returns text language plpgsql security definer set search_path=public,private,vault as $$
declare sid uuid; val text;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  select nullif(secret_refs->>p_key,'')::uuid into sid from private.orbitfs_installation_secret_refs where installation_id=p_installation_id;
  if sid is null then return null; end if;
  select decrypted_secret into val from vault.decrypted_secrets where id=sid;
  return val;
end $$;

create or replace function public.orbitfs_release_public_settings()
returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
 'enabled',enabled,'customer_deploy_enabled',customer_deploy_enabled,'customer_updates_enabled',customer_updates_enabled,
 'customer_rollbacks_enabled',customer_rollbacks_enabled,'allow_existing_supabase_project',allow_existing_supabase_project,
 'allow_create_supabase_project',allow_create_supabase_project,'supabase_oauth_enabled',supabase_oauth_enabled,
 'vercel_oauth_enabled',vercel_oauth_enabled,'schema_version',schema_version,'release_channel',release_channel
) from public.orbitfs_release_system_settings where id='primary';
$$;
revoke all on function public.orbitfs_release_public_settings() from public;
grant execute on function public.orbitfs_release_public_settings() to authenticated;

create or replace function public.ensure_orbitfs_installation(p_binding_id uuid)
returns public.orbitfs_installations language plpgsql security definer set search_path=public as $$
declare b public.license_bindings%rowtype; result public.orbitfs_installations%rowtype; caller uuid:=auth.uid(); base_allowed boolean:=false; cfg public.orbitfs_release_system_settings%rowtype;
begin
  select * into cfg from public.orbitfs_release_system_settings where id='primary';
  if not coalesce(cfg.enabled,false) or not coalesce(cfg.customer_deploy_enabled,false) then raise exception 'OrbitFS deployment system is currently disabled'; end if;
  select * into b from public.license_bindings where id=p_binding_id and archived_at is null;
  if not found then raise exception 'Licence not found'; end if;
  if caller is null then raise exception 'Authentication required'; end if;
  if b.auth_user_id<>caller and not public.has_permission('licenses.edit') then raise exception 'Not allowed to create this OrbitFS installation'; end if;
  base_allowed:=b.license_product_key='orbitfs_base' or coalesce((b.components->>'orbitfs_base')::boolean,false) or coalesce((b.components->>'orbitfs_panel')::boolean,false);
  if not base_allowed then raise exception 'This licence does not include OrbitFS Base'; end if;
  select * into result from public.orbitfs_installations where license_binding_id=b.id and component_key='orbitfs_base';
  if found then
    if result.state='pending' then update public.orbitfs_installations set state='awaiting_supabase',updated_at=now() where id=result.id returning * into result; end if;
    return result;
  end if;
  insert into public.orbitfs_installations(auth_user_id,license_binding_id,order_id,order_item_id,component_key,installation_id,state)
  values(b.auth_user_id,b.id,b.order_id,b.order_item_id,'orbitfs_base','ofs_'||replace(gen_random_uuid()::text,'-',''),'awaiting_supabase') returning * into result;
  return result;
end $$;
revoke all on function public.ensure_orbitfs_installation(uuid) from public;
grant execute on function public.ensure_orbitfs_installation(uuid) to authenticated;
