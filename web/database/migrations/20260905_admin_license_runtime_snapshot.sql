-- Authoritative runtime-client snapshot for the licence API settings page.
create or replace function public.admin_license_runtime_snapshot()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  result jsonb;
begin
  if not (
    public.is_admin()
    or public.has_permission('admin.access')
    or public.has_permission('settings.permissions')
    or public.has_permission('license.manage')
  ) then
    raise exception 'admin permission required';
  end if;

  with runtime_ids as (
    select installation_id,
           max(last_seen_at) as last_seen_at,
           min(registered_at) as registered_at,
           max(device_name) filter (where device_name is not null) as device_name,
           max(platform) filter (where platform is not null) as platform,
           max(app_version) filter (where app_version is not null) as app_version,
           true as registered
      from public.license_installations
     where installation_id is not null
       and installation_id <> 'contract-test'
     group by installation_id
    union all
    select v.installation_id,
           max(v.created_at) as last_seen_at,
           null::timestamptz as registered_at,
           null::text as device_name,
           null::text as platform,
           null::text as app_version,
           false as registered
      from public.license_validation_log v
     where v.installation_id is not null
       and v.installation_id <> 'contract-test'
       and not exists (
         select 1 from public.license_installations i
          where i.installation_id=v.installation_id
       )
     group by v.installation_id
  ),
  clients as (
    select r.installation_id,
           r.device_name,
           r.platform,
           r.app_version,
           r.last_seen_at,
           r.registered_at,
           r.registered,
           coalesce((
             select jsonb_agg(distinct i.component_key order by i.component_key)
               from public.license_installations i
              where i.installation_id=r.installation_id
                and i.component_key is not null
           ),'[]'::jsonb) as components
      from runtime_ids r
  )
  select jsonb_build_object(
    'total',count(*),
    'active_today',count(*) filter (where last_seen_at >= now()-interval '24 hours'),
    'registered',count(*) filter (where registered),
    'validation_only',count(*) filter (where not registered),
    'component_registrations',(select count(*) from public.license_installations where installation_id <> 'contract-test'),
    'clients',coalesce(jsonb_agg(to_jsonb(clients) order by last_seen_at desc),'[]'::jsonb)
  )
  into result
  from clients;

  return result;
end
$function$;
