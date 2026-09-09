-- Standardize the OrbitFS Studio component key.
-- Live migration applied to the OrbitFS Website Supabase project.

create or replace function public.canonical_license_component_key(p_key text)
returns text
language sql
immutable
as $function$
  select case lower(coalesce(p_key,''))
    when 'orbitfs_panel' then 'orbitfs_base'
    when 'orbitfs_base' then 'orbitfs_base'
    when 'orbitfs_sorter' then 'orbitfs_apex'
    when 'orbitfs_apex' then 'orbitfs_apex'
    when 'orbitfs_studio' then 'orbitfs_studio'
    when 'orbitfs_mcp' then 'orbitfs_mcp'
    else lower(coalesce(p_key,''))
  end
$function$;

create or replace function public.admin_issue_website_license(
  p_user_id uuid,
  p_label text,
  p_components jsonb,
  p_expires_at timestamp with time zone default null::timestamp with time zone,
  p_notes text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare k text; h text; bid uuid; comps jsonb;
begin
 if not public.is_admin() then raise exception 'admin required'; end if;
 comps:=coalesce(p_components,'{}'::jsonb);
 comps:=(comps-'orbitfs_panel'-'orbitfs_sorter')
   || case when comps ? 'orbitfs_panel' then jsonb_build_object('orbitfs_base',coalesce((comps->>'orbitfs_panel')::boolean,false) or coalesce((comps->>'orbitfs_base')::boolean,false)) else '{}'::jsonb end
   || case when comps ? 'orbitfs_sorter' then jsonb_build_object('orbitfs_apex',coalesce((comps->>'orbitfs_sorter')::boolean,false) or coalesce((comps->>'orbitfs_apex')::boolean,false)) else '{}'::jsonb end;
 comps:=comps||jsonb_build_object('orbitfs_base',true);
 k:='OFS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 h:=encode(digest(k,'sha256'),'hex');
 insert into public.license_bindings(auth_user_id,license_product_key,desired_state,remote_state,components,label,license_key_hash,license_key_last4,expires_at,notes,api_source)
 values(p_user_id,'orbitfs_base','active','active',comps,coalesce(nullif(trim(p_label),''),'OrbitFS licence'),h,right(k,4),p_expires_at,p_notes,'website') returning id into bid;
 perform public.bump_license_revision();
 insert into public.license_enforcement_queue(binding_id,auth_user_id,action,reason,source,payload) values(bid,p_user_id,'sync','website licence issued','website_engine',jsonb_build_object('components',comps));
 return jsonb_build_object('binding_id',bid,'license_key',k,'last4',right(k,4));
end
$function$;

create or replace function public.grant_paid_order_entitlements_core(p_order_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare r record; fid uuid; bid uuid; comp jsonb; has_base boolean; remote_id text; qid bigint; api_enabled boolean; api_mode text; k text;
begin
 select id,components,license_id into bid,comp,remote_id from public.license_bindings where auth_user_id=p_user_id and desired_state<>'revoked' order by (order_id=p_order_id) desc, created_at asc limit 1;
 has_base:=exists(select 1 from public.download_entitlements de join public.products p on p.id=de.product_id where de.auth_user_id=p_user_id and de.status='active' and p.license_product_key in ('orbitfs_panel','orbitfs_base'));
 for r in select oi.* from public.order_items oi where oi.order_id=p_order_id order by case when oi.license_product_key in ('orbitfs_panel','orbitfs_base') then 0 else 1 end,oi.id loop
   if coalesce((r.configuration->>'gift')::boolean,false) then continue; end if;
   select license_api_enabled,license_api_mode into api_enabled,api_mode from public.products where id=r.product_id;
   if r.license_product_key not in ('orbitfs_panel','orbitfs_base') and not has_base then raise exception 'addon fulfilment requires an active OrbitFS Base entitlement'; end if;
   fid:=null;
   insert into public.license_fulfillments(order_id,order_item_id,auth_user_id,state,metadata) select r.order_id,r.id,p_user_id,'pending',jsonb_build_object('license_product_key',r.license_product_key,'configuration',r.configuration) where not exists(select 1 from public.license_fulfillments lf where lf.order_item_id=r.id) returning id into fid;
   if fid is null then select id into fid from public.license_fulfillments where order_item_id=r.id limit 1; end if;
   if bid is null then
     if r.license_product_key not in ('orbitfs_panel','orbitfs_base') then raise exception 'OrbitFS Base licence binding is missing'; end if;
     comp:=jsonb_build_object('orbitfs_base',true);
     if api_enabled and api_mode='website' then
       k:='OFS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
       insert into public.license_bindings(auth_user_id,fulfillment_id,order_id,order_item_id,license_product_key,desired_state,remote_state,components,label,license_key_hash,license_key_last4,api_source) values(p_user_id,fid,p_order_id,r.id,'orbitfs_base','active','active',comp,'OrbitFS licence',encode(digest(k,'sha256'),'hex'),right(k,4),'website') returning id,license_id into bid,remote_id;
       insert into public.license_key_delivery(binding_id,auth_user_id,license_key) values(bid,p_user_id,k) on conflict(binding_id) do update set license_key=excluded.license_key,created_at=now();
       update public.license_fulfillments set state='fulfilled',metadata=metadata||jsonb_build_object('engine','website','binding_id',bid),updated_at=now() where id=fid; perform public.bump_license_revision();
     else
       insert into public.license_bindings(auth_user_id,fulfillment_id,order_id,order_item_id,license_product_key,desired_state,remote_state,components,api_source) values(p_user_id,fid,p_order_id,r.id,'orbitfs_base','pending','unknown',comp,'legacy') returning id,license_id into bid,remote_id;
       insert into public.license_enforcement_queue(binding_id,auth_user_id,action,reason,source,payload) values(bid,p_user_id,'issue','paid Base entitlement','payment',jsonb_build_object('components',comp)) returning id into qid;
     end if;
     has_base:=true;
   else
     comp:=coalesce(comp,'{}'::jsonb)||jsonb_build_object(case r.license_product_key when 'orbitfs_panel' then 'orbitfs_base' when 'orbitfs_sorter' then 'orbitfs_apex' else r.license_product_key end,true);
     update public.license_bindings set components=comp,updated_at=now() where id=bid returning license_id into remote_id;
     if exists(select 1 from public.license_bindings where id=bid and api_source='website') then update public.license_fulfillments set state='fulfilled',metadata=metadata||jsonb_build_object('engine','website','binding_id',bid),updated_at=now() where id=fid; perform public.bump_license_revision();
     elsif remote_id is null then update public.license_enforcement_queue set action='issue',payload=jsonb_build_object('components',comp),reason='paid products pending initial OrbitFS licence issue' where id=(select q.id from public.license_enforcement_queue q where q.binding_id=bid and q.state='queued' and q.action in ('issue','provision_license') order by q.id desc limit 1); if not found then insert into public.license_enforcement_queue(binding_id,auth_user_id,action,reason,source,payload) values(bid,p_user_id,'issue','paid products pending initial OrbitFS licence issue','payment',jsonb_build_object('components',comp)); end if;
     else insert into public.license_enforcement_queue(binding_id,auth_user_id,license_id,action,reason,source,payload) select b.id,b.auth_user_id,b.license_id,'update_components','paid addon entitlement','payment',jsonb_build_object('components',comp) from public.license_bindings b where b.id=bid and not exists(select 1 from public.license_enforcement_queue q where q.binding_id=b.id and q.state in ('queued','running') and q.action='update_components' and q.payload->'components'=comp); end if;
   end if;
   update public.license_fulfillments set metadata=metadata||jsonb_build_object('binding_id',bid),updated_at=now() where id=fid;
   insert into public.download_entitlements(auth_user_id,order_id,order_item_id,product_id,status,metadata) values(p_user_id,p_order_id,r.id,r.product_id,'active',jsonb_build_object('license_product_key',case r.license_product_key when 'orbitfs_panel' then 'orbitfs_base' when 'orbitfs_sorter' then 'orbitfs_apex' else r.license_product_key end,'binding_id',bid)) on conflict(auth_user_id,order_item_id) do update set status='active',revoked_at=null,reason=null;
 end loop;
 update public.orders set fulfillment_status=case when exists(select 1 from public.license_bindings where id=bid and api_source='website') then 'fulfilled' else 'queued' end,updated_at=now() where id=p_order_id;
end
$function$;
