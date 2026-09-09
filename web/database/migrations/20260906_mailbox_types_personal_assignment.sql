-- OrbitFS Mail mailbox types + personal mailbox assignment.

alter table public.mail_accounts
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null;

update public.mail_accounts
set kind='shared', assigned_user_id=null
where kind not in ('shared','no-reply','personal','system');

alter table public.mail_accounts drop constraint if exists mail_accounts_kind_check;
alter table public.mail_accounts
  add constraint mail_accounts_kind_check
  check (kind in ('shared','no-reply','personal','system'));

alter table public.mail_accounts drop constraint if exists mail_accounts_personal_assignment_check;
alter table public.mail_accounts
  add constraint mail_accounts_personal_assignment_check
  check (
    (kind='personal' and assigned_user_id is not null)
    or (kind<>'personal' and assigned_user_id is null)
  );

-- Personal assignment grants the mailbox-specific view/send scope. The existing
-- global mail.view and mail.send permissions are still required.
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

  local_part:=split_part(lower(p_address),'@',1);
  if p_send then
    return public.has_permission('mail.view')
       and public.has_permission('mail.send')
       and (
         (account_kind='personal' and account_assignee=auth.uid())
         or public.has_permission('mail.account.'||local_part||'.send')
       );
  end if;

  return public.has_permission('mail.view')
     and (
       (account_kind='personal' and account_assignee=auth.uid())
       or public.has_permission('mail.account.'||local_part||'.view')
       or public.has_permission('mail.account.'||local_part||'.send')
     );
end
$$;

-- Keep the existing 3-argument create RPC for compatibility and add the new
-- assignment-aware form used by Mail Config.
create or replace function public.mail_admin_create_account(
  p_address text,
  p_display_name text,
  p_kind text,
  p_assigned_user_id uuid
)
returns boolean
language plpgsql security definer set search_path='public'
as $$
declare
  v_address text:=lower(trim(coalesce(p_address,'')));
  v_display_name text:=trim(coalesce(p_display_name,''));
  v_kind text:=lower(trim(coalesce(p_kind,'shared')));
  v_assignee uuid:=p_assigned_user_id;
begin
  if not public.is_staff() or not public.has_permission('mail.settings') then
    raise exception 'Mail settings permission required';
  end if;
  if v_address='' or v_address !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid mailbox address is required';
  end if;
  if v_kind not in ('shared','no-reply','personal','system') then
    raise exception 'Invalid mailbox type';
  end if;
  if v_kind='personal' then
    if v_assignee is null or not exists(select 1 from public.staff_members where user_id=v_assignee and status='active') then
      raise exception 'Personal mailboxes require an active staff member';
    end if;
  else
    v_assignee:=null;
  end if;
  if v_display_name='' then v_display_name:=split_part(v_address,'@',1); end if;

  insert into public.mail_accounts(address,display_name,kind,active,assigned_user_id)
  values(v_address,v_display_name,v_kind,true,v_assignee);
  return true;
exception
  when unique_violation then raise exception 'Mailbox already exists';
end
$$;

-- Assignment-aware edit RPC. Address remains the stable mailbox identifier.
create or replace function public.mail_admin_update_account(
  p_address text,
  p_display_name text,
  p_kind text,
  p_active boolean,
  p_assigned_user_id uuid
)
returns boolean
language plpgsql security definer set search_path='public'
as $$
declare
  v_kind text:=lower(trim(coalesce(p_kind,'shared')));
  v_assignee uuid:=p_assigned_user_id;
begin
  if not public.is_staff() or not public.has_permission('mail.settings') then
    raise exception 'Mail settings permission required';
  end if;
  if v_kind not in ('shared','no-reply','personal','system') then
    raise exception 'Invalid mailbox type';
  end if;
  if v_kind='personal' then
    if v_assignee is null or not exists(select 1 from public.staff_members where user_id=v_assignee and status='active') then
      raise exception 'Personal mailboxes require an active staff member';
    end if;
  else
    v_assignee:=null;
  end if;

  update public.mail_accounts
  set display_name=coalesce(nullif(trim(p_display_name),''),display_name),
      kind=v_kind,
      active=p_active,
      assigned_user_id=v_assignee,
      updated_at=now()
  where lower(address)=lower(p_address);
  if not found then raise exception 'Mailbox not found'; end if;
  return true;
end
$$;

create or replace function public.mail_admin_snapshot()
returns jsonb
language sql stable security definer set search_path='public'
as $$
 select case when public.is_staff() and (
   public.has_permission('all') or public.has_permission('mail.admin') or public.has_permission('mail.settings')
   or public.has_permission('mail.templates') or public.has_permission('mail.queue.view') or public.has_permission('mail.queue.manage')
 ) then jsonb_build_object(
   'capabilities',jsonb_build_object(
     'admin',public.has_permission('all') or public.has_permission('mail.admin'),
     'settings',public.has_permission('all') or public.has_permission('mail.settings'),
     'templates',public.has_permission('all') or public.has_permission('mail.templates'),
     'queueView',public.has_permission('all') or public.has_permission('mail.queue.view') or public.has_permission('mail.queue.manage'),
     'queueManage',public.has_permission('all') or public.has_permission('mail.queue.manage')
   ),
   'accounts',case when public.has_permission('all') or public.has_permission('mail.settings') then coalesce((select jsonb_agg(to_jsonb(a) order by a.address) from public.mail_accounts a),'[]'::jsonb) else '[]'::jsonb end,
   'settings',case when public.has_permission('all') or public.has_permission('mail.settings') then coalesce((select jsonb_agg(to_jsonb(s) order by s.key) from public.mail_settings s),'[]'::jsonb) else '[]'::jsonb end,
   'templates',case when public.has_permission('all') or public.has_permission('mail.templates') or public.has_permission('mail.settings') then coalesce((select jsonb_agg(to_jsonb(t) order by t.category,t.name) from public.mail_templates t),'[]'::jsonb) else '[]'::jsonb end,
   'automations',case when public.has_permission('all') or public.has_permission('mail.settings') then coalesce((select jsonb_agg(to_jsonb(a) order by a.category,a.name) from public.mail_automations a),'[]'::jsonb) else '[]'::jsonb end,
   'users',case when public.has_permission('all') or public.has_permission('mail.settings') then coalesce((
     select jsonb_agg(jsonb_build_object(
       'id',sm.user_id,
       'display_name',coalesce(nullif(trim(up.display_name),''),nullif(trim(concat_ws(' ',up.first_name,up.last_name)),''),u.email),
       'email',u.email,
       'title',sm.title,
       'department',sm.department
     ) order by coalesce(nullif(trim(up.display_name),''),nullif(trim(concat_ws(' ',up.first_name,up.last_name)),''),u.email))
     from public.staff_members sm
     left join public.user_profiles up on up.id=sm.user_id
     left join auth.users u on u.id=sm.user_id
     where sm.status='active'
   ),'[]'::jsonb) else '[]'::jsonb end,
   'access','[]'::jsonb,
   'logs',case when public.has_permission('all') or public.has_permission('mail.admin') or public.has_permission('mail.queue.view') or public.has_permission('mail.queue.manage') then coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from (select * from public.mail_delivery_log order by created_at desc limit 50) l),'[]'::jsonb) else '[]'::jsonb end
 ) else null end
$$;
