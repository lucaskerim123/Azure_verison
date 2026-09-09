-- Vendor-only release coordinator credentials.
-- Values are stored in Supabase Vault and never returned to browser clients.

create or replace function public.admin_orbitfs_release_system_snapshot()
returns jsonb language sql security definer set search_path=public,private as $$
select case when public.has_permission('licenses.view') then
  jsonb_build_object(
    'settings',to_jsonb(s),
    'supabase_client_secret_configured',exists(select 1 from private.orbitfs_release_secret_refs where key='supabase_client_secret'),
    'vercel_client_secret_configured',exists(select 1 from private.orbitfs_release_secret_refs where key='vercel_client_secret'),
    'panel_publish_token_configured',exists(select 1 from private.orbitfs_release_secret_refs where key='panel_publish_token'),
    'engine_publish_token_configured',exists(select 1 from private.orbitfs_release_secret_refs where key='engine_publish_token'),
    'github_release_token_configured',exists(select 1 from private.orbitfs_release_secret_refs where key='github_release_token'),
    'installations',(select count(*) from public.orbitfs_installations),
    'connected_supabase',(select count(*) from public.orbitfs_provider_connections where provider='supabase' and status='connected'),
    'connected_vercel',(select count(*) from public.orbitfs_provider_connections where provider='vercel' and status='connected')
  ) else '{}'::jsonb end
from public.orbitfs_release_system_settings s where s.id='primary';
$$;
revoke all on function public.admin_orbitfs_release_system_snapshot() from public;
grant execute on function public.admin_orbitfs_release_system_snapshot() to authenticated;

create or replace function public.admin_store_orbitfs_release_secret(p_key text,p_value text)
returns jsonb language plpgsql security definer set search_path=public,private,vault as $$
declare sid uuid;
begin
  if not (public.has_permission('licenses.manage') or public.has_permission('license_api.manage')) then raise exception 'permission denied'; end if;
  if p_key not in ('supabase_client_secret','vercel_client_secret','panel_publish_token','engine_publish_token','github_release_token') then raise exception 'unsupported secret'; end if;
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
