-- Preserve Senior Support as a distinct built-in role while Staff Groups remain authoritative.
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role = any (array['user'::text,'support'::text,'senior-support'::text,'admin'::text,'superadmin'::text]));

create or replace function public.admin_save_staff_member(
  p_user_id uuid,p_title text,p_department text,p_staff_notes text,p_status text,p_group_ids uuid[],p_primary_group_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  existing_staff boolean; includes_superadmin boolean; includes_admin boolean; target_was_superadmin boolean;
  active_superadmins integer; primary_id uuid; primary_slug text; legacy_role text;
begin
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then raise exception 'User not found'; end if;
  existing_staff := exists(select 1 from public.staff_members where user_id=p_user_id);
  if existing_staff then
    if not (public.has_permission('staff.manage') or public.has_permission('settings.permissions')) then raise exception 'Permission denied'; end if;
  else
    if not (public.has_permission('staff.invite') or public.has_permission('settings.permissions')) then raise exception 'Permission denied'; end if;
  end if;
  if p_status not in ('active','disabled') then raise exception 'Invalid staff status'; end if;
  if p_group_ids is null or coalesce(array_length(p_group_ids,1),0)=0 then raise exception 'At least one staff group is required'; end if;
  if exists(select 1 from unnest(p_group_ids) g left join public.staff_groups sg on sg.id=g where sg.id is null) then raise exception 'Invalid staff group'; end if;
  select exists(select 1 from public.staff_groups where id=any(p_group_ids) and slug='superadmin') into includes_superadmin;
  select exists(select 1 from public.staff_groups where id=any(p_group_ids) and slug='admin') into includes_admin;
  if includes_superadmin and not public.has_permission('settings.permissions') then raise exception 'Only permission administrators can assign Superadmin'; end if;
  if p_user_id=auth.uid() and p_status='disabled' then raise exception 'You cannot disable your own staff access'; end if;
  select exists(select 1 from public.staff_member_groups smg join public.staff_groups sg on sg.id=smg.group_id where smg.user_id=p_user_id and sg.slug='superadmin') into target_was_superadmin;
  if target_was_superadmin and (p_status='disabled' or not includes_superadmin) then
    select count(distinct sm.user_id) into active_superadmins from public.staff_members sm join public.staff_member_groups smg on smg.user_id=sm.user_id join public.staff_groups sg on sg.id=smg.group_id where sm.status='active' and sg.slug='superadmin';
    if active_superadmins<=1 then raise exception 'Cannot remove or disable the last active Superadmin'; end if;
  end if;
  primary_id := case when p_primary_group_id=any(p_group_ids) then p_primary_group_id else p_group_ids[1] end;
  select slug into primary_slug from public.staff_groups where id=primary_id;
  legacy_role := case when includes_superadmin then 'superadmin' when includes_admin then 'admin' when primary_slug='senior-support' then 'senior-support' else 'support' end;
  insert into public.staff_members(user_id,status,title,department,staff_notes,created_by,updated_at)
  values(p_user_id,p_status,nullif(trim(coalesce(p_title,'')),''),nullif(trim(coalesce(p_department,'')),''),nullif(trim(coalesce(p_staff_notes,'')),''),auth.uid(),now())
  on conflict(user_id) do update set status=excluded.status,title=excluded.title,department=excluded.department,staff_notes=excluded.staff_notes,updated_at=now();
  delete from public.staff_member_groups where user_id=p_user_id;
  insert into public.staff_member_groups(user_id,group_id,is_primary) select p_user_id,g,(g=primary_id) from unnest(p_group_ids) g;
  update public.user_profiles set role=legacy_role where id=p_user_id;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),case when existing_staff then 'staff.member_updated' else 'staff.member_saved' end,'staff_member',p_user_id,jsonb_build_object('groups',p_group_ids,'primary_group_id',primary_id,'primary_group_slug',primary_slug,'legacy_role',legacy_role,'status',p_status));
  return jsonb_build_object('ok',true,'user_id',p_user_id,'primary_group_id',primary_id,'primary_role',primary_slug,'legacy_role',legacy_role);
end
$function$;
