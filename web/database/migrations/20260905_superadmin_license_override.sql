-- Allow Superadmin to deliberately issue additional active website licences while preserving normal one-active-per-user enforcement.

alter table public.license_bindings
  add column if not exists admin_override boolean not null default false;

drop index if exists public.license_bindings_one_active_per_user;

create unique index license_bindings_one_active_per_user
  on public.license_bindings(auth_user_id)
  where archived_at is null
    and desired_state <> 'revoked'
    and admin_override = false;

drop function if exists public.admin_issue_website_license(uuid,text,jsonb,timestamptz,text);

create or replace function public.admin_issue_website_license(
  p_user_id uuid,
  p_label text,
  p_components jsonb,
  p_expires_at timestamp with time zone default null::timestamp with time zone,
  p_notes text default null::text,
  p_superadmin_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  k text; h text; bid uuid; comps jsonb;
  actor_is_superadmin boolean;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;

  select exists(
    select 1
    from public.staff_members sm
    join public.staff_member_groups smg on smg.user_id=sm.user_id
    join public.staff_groups sg on sg.id=smg.group_id
    where sm.user_id=auth.uid()
      and sm.status='active'
      and sg.slug='superadmin'
  ) into actor_is_superadmin;

  if p_superadmin_override and not actor_is_superadmin then
    raise exception 'Superadmin required for licence override';
  end if;

  comps:=coalesce(p_components,'{}'::jsonb);
  comps:=(comps-'orbitfs_panel'-'orbitfs_sorter')
    || case when comps ? 'orbitfs_panel'
         then jsonb_build_object('orbitfs_base',coalesce((comps->>'orbitfs_panel')::boolean,false) or coalesce((comps->>'orbitfs_base')::boolean,false))
         else '{}'::jsonb end
    || case when comps ? 'orbitfs_sorter'
         then jsonb_build_object('orbitfs_apex',coalesce((comps->>'orbitfs_sorter')::boolean,false) or coalesce((comps->>'orbitfs_apex')::boolean,false))
         else '{}'::jsonb end;
  comps:=comps||jsonb_build_object('orbitfs_base',true);

  k:='OFS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'
    ||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'
    ||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'
    ||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  h:=encode(digest(k,'sha256'),'hex');

  insert into public.license_bindings(
    auth_user_id,license_product_key,desired_state,remote_state,components,label,
    license_key_hash,license_key_last4,expires_at,notes,api_source,admin_override
  )
  values(
    p_user_id,'orbitfs_base','active','active',comps,
    coalesce(nullif(trim(p_label),''),'OrbitFS licence'),
    h,right(k,4),p_expires_at,p_notes,'website',p_superadmin_override
  )
  returning id into bid;

  perform public.bump_license_revision();

  insert into public.license_enforcement_queue(
    binding_id,auth_user_id,action,reason,source,payload
  )
  values(
    bid,p_user_id,'sync',
    case when p_superadmin_override then 'website licence issued by Superadmin override' else 'website licence issued' end,
    'website_engine',
    jsonb_build_object('components',comps,'superadmin_override',p_superadmin_override)
  );

  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(
    auth.uid(),
    case when p_superadmin_override then 'license.superadmin_override_issued' else 'license.website_issued' end,
    'license_binding',
    bid::text,
    jsonb_build_object('auth_user_id',p_user_id,'components',comps,'superadmin_override',p_superadmin_override)
  );

  return jsonb_build_object(
    'binding_id',bid,
    'license_key',k,
    'last4',right(k,4),
    'superadmin_override',p_superadmin_override
  );
end
$function$;
