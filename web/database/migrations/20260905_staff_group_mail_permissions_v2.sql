-- Staff-group controlled OrbitFS Mail permissions.
-- Mailbox authority now comes from staff_groups.permissions; legacy per-user mail_account_access is no longer used for authorization.

create or replace function public.mail_has_any_system_permission()
returns boolean language sql stable security definer set search_path='public' as $$
 select public.has_permission('all')
    or public.has_permission('mail.view')
    or public.has_permission('mail.admin')
    or public.has_permission('mail.admin.send')
    or public.has_permission('mail.settings')
    or public.has_permission('mail.templates')
    or public.has_permission('mail.queue.view')
    or public.has_permission('mail.queue.manage');
$$;

create or replace function public.mail_can_use_address(p_address text, p_send boolean default false)
returns boolean
language plpgsql stable security definer set search_path='public'
as $$
declare local_part text;
begin
  if auth.uid() is null or not public.is_staff() then return false; end if;
  if public.has_permission('all') then return true; end if;
  local_part:=split_part(lower(p_address),'@',1);
  if not exists(select 1 from public.mail_accounts where lower(address)=lower(p_address) and active=true) then return false; end if;
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

create or replace function public.mail_can_send_address_admin(p_address text)
returns boolean
language plpgsql stable security definer set search_path='public'
as $$
declare local_part text;
begin
  if auth.uid() is null or not public.is_staff() then return false; end if;
  if public.has_permission('all') then return true; end if;
  local_part:=split_part(lower(p_address),'@',1);
  if not exists(select 1 from public.mail_accounts where lower(address)=lower(p_address) and active=true) then return false; end if;
  return public.has_permission('mail.admin.send')
     and public.has_permission('mail.account.'||local_part||'.send');
end
$$;

create or replace function public.mail_visible_accounts()
returns table(id uuid,address text,display_name text,kind text,active boolean,can_send boolean,can_manage boolean)
language sql stable security definer set search_path='public'
as $$
 select a.id,a.address,a.display_name,a.kind,a.active,
        public.mail_can_use_address(a.address,true) as can_send,
        (public.has_permission('all') or public.has_permission('mail.settings')) as can_manage
 from public.mail_accounts a
 where a.active=true and public.mail_can_use_address(a.address,false)
 order by a.address
$$;

update public.staff_groups
set permissions =
  (
    permissions
    || case when coalesce((permissions->>'mail.account.admin')::boolean,false) then '{"mail.account.admin.view":true,"mail.account.admin.send":true,"mail.send":true}'::jsonb else '{}'::jsonb end
    || case when coalesce((permissions->>'mail.account.billing')::boolean,false) then '{"mail.account.billing.view":true,"mail.account.billing.send":true,"mail.send":true}'::jsonb else '{}'::jsonb end
    || case when coalesce((permissions->>'mail.account.support')::boolean,false) then '{"mail.account.support.view":true,"mail.account.support.send":true,"mail.send":true}'::jsonb else '{}'::jsonb end
    || case when coalesce((permissions->>'support.reply')::boolean,false) then '{"mail.admin.send":true}'::jsonb else '{}'::jsonb end
    || case when coalesce((permissions->>'mail.admin')::boolean,false) then '{"mail.queue.view":true,"mail.queue.manage":true}'::jsonb else '{}'::jsonb end
  )
  - 'mail.account.admin'
  - 'mail.account.billing'
  - 'mail.account.support'
  - 'mail.users',
updated_at=now();
