-- Account suspension / ban enforcement v2.
alter table public.user_profiles add column if not exists suspension_expires_at timestamptz;

create or replace function public.account_enforcement_status(target_user uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare r jsonb;
begin
  if target_user is null then return jsonb_build_object('state','active','support_email','support@orbitfs.cc'); end if;
  if auth.uid() is not null and target_user<>auth.uid() and not public.has_permission('customers.enforce') then raise exception 'permission denied'; end if;
  select jsonb_build_object(
    'state',case when p.banned_at is not null and (p.ban_expires_at is null or p.ban_expires_at>now()) then 'banned'
                 when p.status='suspended' and (p.suspension_expires_at is null or p.suspension_expires_at>now()) then 'suspended'
                 else 'active' end,
    'reason',case when p.banned_at is not null and (p.ban_expires_at is null or p.ban_expires_at>now()) then p.ban_reason
                  when p.status='suspended' and (p.suspension_expires_at is null or p.suspension_expires_at>now()) then p.suspension_reason else null end,
    'expires_at',case when p.banned_at is not null and (p.ban_expires_at is null or p.ban_expires_at>now()) then p.ban_expires_at
                      when p.status='suspended' and (p.suspension_expires_at is null or p.suspension_expires_at>now()) then p.suspension_expires_at else null end,
    'permanent',case when p.banned_at is not null and (p.ban_expires_at is null or p.ban_expires_at>now()) then p.ban_expires_at is null
                     when p.status='suspended' and (p.suspension_expires_at is null or p.suspension_expires_at>now()) then p.suspension_expires_at is null else false end,
    'suspended_at',p.suspended_at,'banned_at',p.banned_at,'support_email','support@orbitfs.cc')
  into r from public.user_profiles p where p.id=target_user;
  return coalesce(r,jsonb_build_object('state','active','support_email','support@orbitfs.cc'));
end $$;

create or replace function public.account_can_order(target_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path='public' as $$
 select coalesce((public.account_enforcement_status(target_user)->>'state')='active',false)
$$;

create or replace function public.admin_set_account_enforcement_v2(target_user uuid,new_state text,why text default null,expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare target_role text; changed_ids uuid[];
begin
 if not public.has_permission('customers.enforce') then raise exception 'permission denied: customers.enforce'; end if;
 if target_user=auth.uid() then raise exception 'you cannot enforce your own account'; end if;
 select role into target_role from public.user_profiles where id=target_user;
 if target_role is null then raise exception 'customer not found'; end if;
 if target_role='superadmin' and public.current_role()<>'superadmin' then raise exception 'only superadmin can enforce another superadmin'; end if;
 if new_state not in ('active','suspended','banned') then raise exception 'invalid state'; end if;
 if new_state<>'active' and nullif(trim(coalesce(why,'')),'') is null then raise exception 'reason is required'; end if;
 if expires_at is not null and expires_at<=now() then raise exception 'expiry must be in the future'; end if;

 if new_state='active' then
  update public.user_profiles set status='active',suspension_reason=null,suspended_at=null,suspension_expires_at=null,banned_at=null,ban_reason=null,ban_expires_at=null,updated_at=now() where id=target_user;
  with restored as (
   update public.license_bindings set desired_state='active',remote_state=case when api_source='website' then 'active' else remote_state end,suspension_reason=null,updated_at=now()
   where auth_user_id=target_user and archived_at is null and desired_state='suspended' and suspension_reason like 'account_enforcement:%'
   returning id,auth_user_id,license_id,api_source
  ) select array_agg(id) into changed_ids from restored;
  insert into public.license_enforcement_queue(binding_id,auth_user_id,license_id,action,reason,source)
   select b.id,b.auth_user_id,b.license_id,'unblock','account enforcement cleared','account_enforcement'
   from public.license_bindings b where b.id=any(coalesce(changed_ids,'{}'::uuid[])) and b.api_source<>'website'
   and not exists(select 1 from public.license_enforcement_queue q where q.binding_id=b.id and q.action='unblock' and q.state in ('queued','running'));
 elsif new_state='suspended' then
  update public.user_profiles set status='suspended',suspension_reason=trim(why),suspended_at=now(),suspension_expires_at=expires_at,banned_at=null,ban_reason=null,ban_expires_at=null,updated_at=now() where id=target_user;
  with changed as (
   update public.license_bindings set desired_state='suspended',remote_state=case when api_source='website' then 'suspended' else remote_state end,suspension_reason='account_enforcement:suspended:'||trim(why),updated_at=now()
   where auth_user_id=target_user and archived_at is null and desired_state='active'
   returning id,auth_user_id,license_id,api_source
  ) select array_agg(id) into changed_ids from changed;
  insert into public.license_enforcement_queue(binding_id,auth_user_id,license_id,action,reason,source)
   select b.id,b.auth_user_id,b.license_id,'block','account suspended: '||trim(why),'account_enforcement'
   from public.license_bindings b where b.id=any(coalesce(changed_ids,'{}'::uuid[])) and b.api_source<>'website'
   and not exists(select 1 from public.license_enforcement_queue q where q.binding_id=b.id and q.action='block' and q.state in ('queued','running'));
 else
  update public.user_profiles set status='suspended',suspension_reason=null,suspended_at=coalesce(suspended_at,now()),suspension_expires_at=null,banned_at=now(),ban_reason=trim(why),ban_expires_at=expires_at,updated_at=now() where id=target_user;
  with changed as (
   update public.license_bindings set desired_state='suspended',remote_state=case when api_source='website' then 'suspended' else remote_state end,suspension_reason='account_enforcement:banned:'||trim(why),updated_at=now()
   where auth_user_id=target_user and archived_at is null and desired_state='active'
   returning id,auth_user_id,license_id,api_source
  ) select array_agg(id) into changed_ids from changed;
  insert into public.license_enforcement_queue(binding_id,auth_user_id,license_id,action,reason,source)
   select b.id,b.auth_user_id,b.license_id,'block','account banned: '||trim(why),'account_enforcement'
   from public.license_bindings b where b.id=any(coalesce(changed_ids,'{}'::uuid[])) and b.api_source<>'website'
   and not exists(select 1 from public.license_enforcement_queue q where q.binding_id=b.id and q.action='block' and q.state in ('queued','running'));
 end if;

 if coalesce(array_length(changed_ids,1),0)>0 then perform public.bump_license_revision(); end if;
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
 values(auth.uid(),'customer.enforcement','user',target_user::text,jsonb_build_object('state',new_state,'reason',why,'expires_at',expires_at,'license_bindings_changed',coalesce(array_length(changed_ids,1),0)));
 return jsonb_build_object('ok',true,'state',new_state,'reason',why,'expires_at',expires_at,'license_bindings_changed',coalesce(array_length(changed_ids,1),0));
end $$;

create or replace function public.admin_set_account_enforcement(target_user uuid,new_state text,why text default null)
returns jsonb language sql security definer set search_path='public' as $$
 select public.admin_set_account_enforcement_v2(target_user,new_state,why,null)
$$;

create or replace function public.expire_account_enforcement()
returns jsonb language plpgsql security definer set search_path='public' as $$
declare ids uuid[]; restored integer:=0; users_restored integer:=0;
begin
 select array_agg(id) into ids from public.user_profiles
 where (banned_at is not null and ban_expires_at is not null and ban_expires_at<=now())
    or (status='suspended' and banned_at is null and suspension_expires_at is not null and suspension_expires_at<=now());
 if coalesce(array_length(ids,1),0)=0 then return jsonb_build_object('users_restored',0,'licenses_restored',0); end if;
 update public.user_profiles set status='active',suspension_reason=null,suspended_at=null,suspension_expires_at=null,banned_at=null,ban_reason=null,ban_expires_at=null,updated_at=now() where id=any(ids);
 get diagnostics users_restored=row_count;
 with changed as (
  update public.license_bindings set desired_state='active',remote_state=case when api_source='website' then 'active' else remote_state end,suspension_reason=null,updated_at=now()
  where auth_user_id=any(ids) and archived_at is null and desired_state='suspended' and suspension_reason like 'account_enforcement:%'
  returning id
 ) select count(*) into restored from changed;
 insert into public.license_enforcement_queue(binding_id,auth_user_id,license_id,action,reason,source)
 select b.id,b.auth_user_id,b.license_id,'unblock','account enforcement expired','account_enforcement'
 from public.license_bindings b where b.auth_user_id=any(ids) and b.api_source<>'website' and b.updated_at>now()-interval '1 minute' and b.desired_state='active'
 and not exists(select 1 from public.license_enforcement_queue q where q.binding_id=b.id and q.action='unblock' and q.state in ('queued','running'));
 if restored>0 then perform public.bump_license_revision(); end if;
 return jsonb_build_object('users_restored',users_restored,'licenses_restored',restored);
end $$;

create or replace function public.admin_enforced_accounts()
returns table(id uuid,display_name text,customer_number text,status text,effective_state text,reason text,expires_at timestamptz,suspended_at timestamptz,banned_at timestamptz)
language sql stable security definer set search_path='public' as $$
 select p.id,p.display_name,p.customer_number,p.status,
 public.account_enforcement_status(p.id)->>'state',
 public.account_enforcement_status(p.id)->>'reason',
 nullif(public.account_enforcement_status(p.id)->>'expires_at','')::timestamptz,
 p.suspended_at,p.banned_at
 from public.user_profiles p
 where public.has_permission('customers.enforce') and (public.account_enforcement_status(p.id)->>'state') in ('suspended','banned')
 order by coalesce(p.banned_at,p.suspended_at) desc
$$;

do $$
declare jid bigint;
begin
 select jobid into jid from cron.job where jobname='expire-account-enforcement' limit 1;
 if jid is not null then perform cron.unschedule(jid); end if;
 perform cron.schedule('expire-account-enforcement','* * * * *','select public.expire_account_enforcement();');
end $$;
