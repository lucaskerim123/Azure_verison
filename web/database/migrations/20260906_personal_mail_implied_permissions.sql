-- Personal mailbox assignment carries the base Mail capability for the assignee.
-- This is effective access only; staff group permission maps remain unchanged.

create or replace function public.get_my_staff_access()
returns jsonb
language sql
stable security definer
set search_path='public'
as $$
  select jsonb_build_object(
    'is_staff', exists(select 1 from public.staff_members sm where sm.user_id=auth.uid() and sm.status='active'),
    'status', coalesce((select sm.status from public.staff_members sm where sm.user_id=auth.uid()),'none'),
    'primary_role', public.current_role(),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id',sg.id,'slug',sg.slug,'name',sg.name,'is_primary',smg.is_primary) order by smg.is_primary desc,sg.sort_order,sg.name)
      from public.staff_member_groups smg
      join public.staff_groups sg on sg.id=smg.group_id
      join public.staff_members sm on sm.user_id=smg.user_id
      where smg.user_id=auth.uid() and sm.status='active'
    ),'[]'::jsonb),
    'permissions', coalesce((
      select jsonb_object_agg(k,true)
      from (
        select distinct key as k
        from public.staff_member_groups smg
        join public.staff_groups sg on sg.id=smg.group_id
        join public.staff_members sm on sm.user_id=smg.user_id
        cross join lateral jsonb_each_text(sg.permissions)
        where smg.user_id=auth.uid() and sm.status='active' and value='true'
        union
        select 'mail.view'
        where exists(
          select 1 from public.mail_accounts a
          join public.staff_members sm on sm.user_id=auth.uid() and sm.status='active'
          where a.kind='personal' and a.active=true and a.assigned_user_id=auth.uid()
        )
        union
        select 'mail.send'
        where exists(
          select 1 from public.mail_accounts a
          join public.staff_members sm on sm.user_id=auth.uid() and sm.status='active'
          where a.kind='personal' and a.active=true and a.assigned_user_id=auth.uid()
        )
      ) x
    ),'{}'::jsonb)
  )
$$;

create or replace function public.mail_can_use_address(p_address text, p_send boolean default false)
returns boolean
language plpgsql stable security definer set search_path='public'
as $$
declare
  local_part text;
  account_kind text;
  account_assignee uuid;
begin
  if auth.uid() is null or not public.is_staff() then return false; end if;
  if public.has_permission('all') then return true; end if;

  select kind,assigned_user_id into account_kind,account_assignee
  from public.mail_accounts
  where lower(address)=lower(p_address) and active=true;
  if not found then return false; end if;

  if account_kind='personal' and account_assignee=auth.uid() then return true; end if;

  local_part:=split_part(lower(p_address),'@',1);
  if p_send then
    return public.has_permission('mail.view')
       and public.has_permission('mail.send')
       and public.has_permission('mail.account.'||local_part||'.send');
  end if;

  return public.has_permission('mail.view')
     and (public.has_permission('mail.account.'||local_part||'.view')
          or public.has_permission('mail.account.'||local_part||'.send'));
end
$$;

create or replace function public.mail_has_any_system_permission()
returns boolean language sql stable security definer set search_path='public' as $$
 select public.has_permission('all')
    or public.has_permission('mail.view')
    or public.has_permission('mail.admin')
    or public.has_permission('mail.admin.send')
    or public.has_permission('mail.settings')
    or public.has_permission('mail.templates')
    or public.has_permission('mail.queue.view')
    or public.has_permission('mail.queue.manage')
    or exists(select 1 from public.mail_accounts a where a.kind='personal' and a.active=true and a.assigned_user_id=auth.uid());
$$;
