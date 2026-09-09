-- OrbitFS installation lifecycle and licence-binding continuity.
-- Customer Supabase projects/data are never deleted by these Store-side functions.

create or replace function public.service_delete_orbitfs_installation(p_installation_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public','private','vault'
as $function$
declare refs jsonb; sid text; removed boolean:=false;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  select secret_refs into refs from private.orbitfs_installation_secret_refs where installation_id=p_installation_id;
  delete from public.orbitfs_installations where id=p_installation_id;
  removed:=found;
  if not removed then return false; end if;
  for sid in select value from jsonb_each_text(coalesce(refs,'{}'::jsonb)) loop
    begin delete from vault.secrets where id=sid::uuid; exception when others then null; end;
  end loop;
  return true;
end
$function$;
revoke all on function public.service_delete_orbitfs_installation(uuid) from public, anon, authenticated;
grant execute on function public.service_delete_orbitfs_installation(uuid) to service_role;

create or replace function public.ensure_orbitfs_installation(p_binding_id uuid)
returns public.orbitfs_installations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  b public.license_bindings%rowtype;
  result public.orbitfs_installations%rowtype;
  caller uuid:=auth.uid();
  base_allowed boolean:=false;
  cfg public.orbitfs_release_system_settings%rowtype;
  reusable_id uuid;
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
  select i.id into reusable_id
  from public.orbitfs_installations i
  left join public.license_bindings oldb on oldb.id=i.license_binding_id
  where i.auth_user_id=b.auth_user_id and i.component_key='orbitfs_base' and (oldb.id is null or oldb.archived_at is not null)
  order by case when i.release_version is not null or i.state='ready' then 50 when i.vercel_project_id is not null then 40 when i.database_initialized_at is not null then 30 when i.supabase_project_ref is not null then 20 else 10 end desc,i.updated_at desc
  limit 1;
  if reusable_id is not null then
    update public.orbitfs_installations set license_binding_id=b.id,order_id=b.order_id,order_item_id=b.order_item_id,updated_at=now() where id=reusable_id returning * into result;
    return result;
  end if;
  insert into public.orbitfs_installations(auth_user_id,license_binding_id,order_id,order_item_id,component_key,installation_id,state)
  values(b.auth_user_id,b.id,b.order_id,b.order_item_id,'orbitfs_base','ofs_'||replace(gen_random_uuid()::text,'-',''),'awaiting_supabase') returning * into result;
  return result;
end
$function$;
grant execute on function public.ensure_orbitfs_installation(uuid) to authenticated;
