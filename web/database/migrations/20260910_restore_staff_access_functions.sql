-- Restore the core staff access functions required by the Master Admin portal.
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path='public' as $$
  select auth.uid() is not null and exists(select 1 from public.staff_members sm where sm.user_id=auth.uid() and sm.status='active');
$$;
create or replace function public.current_role() returns text language sql stable security definer set search_path='public' as $$
  select coalesce((select up.role from public.user_profiles up where up.id=auth.uid()),(select sg.slug from public.staff_member_groups smg join public.staff_groups sg on sg.id=smg.group_id join public.staff_members sm on sm.user_id=smg.user_id where smg.user_id=auth.uid() and sm.status='active' order by smg.is_primary desc,sg.sort_order,sg.name limit 1),'user');
$$;
create or replace function public.has_permission(p_permission text) returns boolean language sql stable security definer set search_path='public' as $$
  select auth.uid() is not null and exists(select 1 from public.staff_members sm join public.staff_member_groups smg on smg.user_id=sm.user_id join public.staff_groups sg on sg.id=smg.group_id where sm.user_id=auth.uid() and sm.status='active' and (coalesce(sg.permissions,'{}'::jsonb)->>p_permission)='true') or (p_permission='all' and auth.uid() is not null and exists(select 1 from public.staff_members sm join public.staff_member_groups smg on smg.user_id=sm.user_id join public.staff_groups sg on sg.id=smg.group_id where sm.user_id=auth.uid() and sm.status='active' and (coalesce(sg.permissions,'{}'::jsonb)->>'all')='true'));
$$;
create or replace function public.get_my_staff_access() returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object('is_staff',exists(select 1 from public.staff_members sm where sm.user_id=auth.uid() and sm.status='active'),'status',coalesce((select sm.status from public.staff_members sm where sm.user_id=auth.uid()),'none'),'primary_role',public.current_role(),'groups',coalesce((select jsonb_agg(jsonb_build_object('id',sg.id,'slug',sg.slug,'name',sg.name,'is_primary',smg.is_primary) order by smg.is_primary desc,sg.sort_order,sg.name) from public.staff_member_groups smg join public.staff_groups sg on sg.id=smg.group_id join public.staff_members sm on sm.user_id=smg.user_id where smg.user_id=auth.uid() and sm.status='active'),'[]'::jsonb),'permissions',coalesce((select jsonb_object_agg(k,true) from (select distinct e.key as k from public.staff_member_groups smg join public.staff_groups sg on sg.id=smg.group_id join public.staff_members sm on sm.user_id=smg.user_id cross join lateral jsonb_each_text(coalesce(sg.permissions,'{}'::jsonb)) e where smg.user_id=auth.uid() and sm.status='active' and e.value='true') x),'{}'::jsonb'));
$$;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.current_role() to anon, authenticated;
grant execute on function public.has_permission(text) to anon, authenticated;
grant execute on function public.get_my_staff_access() to anon, authenticated;
