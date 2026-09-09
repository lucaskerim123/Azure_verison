-- OrbitFS Support System v2
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.
-- Adds the Support -> Senior Support -> Administrator -> Superadmin hierarchy,
-- department staffing, ticket escalation, admin-created tickets and Knowledge Base.

alter table public.support_tickets
  add column if not exists escalation_level integer not null default 0,
  add column if not exists escalation_reason text,
  add column if not exists escalated_at timestamptz,
  add column if not exists escalated_by uuid references auth.users(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='support_tickets_escalation_level_check' and conrelid='public.support_tickets'::regclass) then
    alter table public.support_tickets add constraint support_tickets_escalation_level_check check (escalation_level between 0 and 3);
  end if;
end $$;

create table if not exists public.support_department_staff (
  department_id uuid not null references public.support_departments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (department_id,user_id)
);
create index if not exists support_department_staff_user_idx on public.support_department_staff(user_id,department_id);
alter table public.support_department_staff enable row level security;
drop policy if exists support_department_staff_read on public.support_department_staff;
create policy support_department_staff_read on public.support_department_staff for select using (public.is_staff());
drop policy if exists support_department_staff_manage on public.support_department_staff;
create policy support_department_staff_manage on public.support_department_staff for all using (public.has_permission('support.departments.manage') or public.has_permission('support.settings')) with check (public.has_permission('support.departments.manage') or public.has_permission('support.settings'));

create table if not exists public.support_kb_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_kb_articles (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.support_kb_categories(id) on delete set null,
  title text not null,
  slug text not null unique,
  summary text,
  body text not null default '',
  status text not null default 'draft' check (status in ('draft','published','archived')),
  customer_visible boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 100,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_kb_articles_category_idx on public.support_kb_articles(category_id,status,sort_order);
alter table public.support_kb_categories enable row level security;
alter table public.support_kb_articles enable row level security;
drop policy if exists support_kb_categories_read on public.support_kb_categories;
create policy support_kb_categories_read on public.support_kb_categories for select using (enabled=true or public.has_permission('support.kb.view'));
drop policy if exists support_kb_categories_manage on public.support_kb_categories;
create policy support_kb_categories_manage on public.support_kb_categories for all using (public.has_permission('support.kb.manage')) with check (public.has_permission('support.kb.manage'));
drop policy if exists support_kb_articles_read on public.support_kb_articles;
create policy support_kb_articles_read on public.support_kb_articles for select using ((status='published' and customer_visible=true) or public.has_permission('support.kb.view'));
drop policy if exists support_kb_articles_manage on public.support_kb_articles;
create policy support_kb_articles_manage on public.support_kb_articles for all using (public.has_permission('support.kb.manage')) with check (public.has_permission('support.kb.manage'));

create or replace function public.support_staff_rank(p_user_id uuid default auth.uid()) returns integer
language sql stable security definer set search_path='public' as $$
  select coalesce(max(case sg.slug when 'superadmin' then 4 when 'admin' then 3 when 'senior-support' then 2 when 'support' then 1 else 0 end),0)
  from public.staff_members sm
  left join public.staff_member_groups smg on smg.user_id=sm.user_id
  left join public.staff_groups sg on sg.id=smg.group_id
  where sm.user_id=p_user_id and sm.status='active'
$$;

create or replace function public.support_staff_rank_label(p_rank integer) returns text
language sql immutable as $$
  select case p_rank when 4 then 'Superadmin' when 3 then 'Administrator' when 2 then 'Senior Support' when 1 then 'Support' else 'No support role' end
$$;

create or replace function public.support_user_has_department(p_user_id uuid,p_department_id uuid) returns boolean
language sql stable security definer set search_path='public' as $$
  select public.support_staff_rank(p_user_id)>=3 or exists(select 1 from public.support_department_staff ds where ds.user_id=p_user_id and ds.department_id=p_department_id)
$$;

update public.staff_groups
set permissions=coalesce(permissions,'{}'::jsonb)||jsonb_build_object(
  'support.ticket_create',true,
  'support.escalate',true,
  'support.kb.view',true,
  'support.departments.manage',false,
  'support.escalation.manage',false,
  'support.kb.manage',false
),description='Front-line customer support worker.',sort_order=20,updated_at=now()
where slug='support';

insert into public.staff_groups(slug,name,description,permissions,is_system,sort_order)
values('senior-support','Senior Support','Support supervisor. Can assign staff, manage escalations and maintain support knowledge.',
'{"portal":true,"admin.access":true,"mail.view":true,"mail.account.support":true,"customers.view":true,"orders.view":true,"invoices.view":true,"licenses.view":true,"support.manage":true,"support.claim":true,"support.assign":true,"support.transfer":true,"support.reply":true,"support.priority":true,"support.department":true,"support.close":true,"support.archive":true,"support.ticket_edit":true,"support.premade.use":true,"support.premade.manage":true,"support.ticket_create":true,"support.escalate":true,"support.escalation.manage":true,"support.kb.view":true,"support.kb.manage":true,"notes.customer.view":true,"notes.order.view":true,"notes.invoice.view":true,"notes.support.view":true,"notes.support.manage":true,"notes.external":true}'::jsonb,true,15)
on conflict (slug) do update set name=excluded.name,description=excluded.description,permissions=excluded.permissions,is_system=true,sort_order=excluded.sort_order,updated_at=now();

update public.staff_groups
set permissions=coalesce(permissions,'{}'::jsonb)||jsonb_build_object(
  'support.ticket_create',true,
  'support.escalate',true,
  'support.escalation.manage',true,
  'support.departments.manage',true,
  'support.kb.view',true,
  'support.kb.manage',true
),description='Administrative manager with broad operational control.',sort_order=10,updated_at=now()
where slug='admin';

update public.staff_groups
set description='Full protected system authority. Final support escalation level and system owner authority.',sort_order=1,updated_at=now()
where slug='superadmin';

create or replace function public.admin_support_settings_snapshot() returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare deps jsonb; people jsonb; templates jsonb;
begin
  if not (public.has_permission('support.settings') or public.has_permission('support.departments.manage')) then raise exception 'permission denied: support.departments.manage'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'name',d.name,'slug',d.slug,'description',d.description,'email',d.email,'enabled',d.enabled,
    'client_can_close',d.client_can_close,'auto_close_hours',d.auto_close_hours,'sort_order',d.sort_order,
    'member_ids',coalesce((select jsonb_agg(ds.user_id order by ds.created_at) from public.support_department_staff ds where ds.department_id=d.id),'[]'::jsonb)
  ) order by d.sort_order,d.name),'[]'::jsonb) into deps from public.support_departments d;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',sm.user_id,
    'display_name',coalesce(up.display_name,trim(concat_ws(' ',up.first_name,up.last_name)),au.email,sm.user_id::text),
    'email',au.email,'title',sm.title,'status',sm.status,
    'rank',public.support_staff_rank(sm.user_id),'rank_label',public.support_staff_rank_label(public.support_staff_rank(sm.user_id))
  ) order by public.support_staff_rank(sm.user_id) desc,coalesce(up.display_name,au.email)),'[]'::jsonb)
  into people
  from public.staff_members sm left join public.user_profiles up on up.id=sm.user_id left join auth.users au on au.id=sm.user_id
  where sm.status='active' and public.support_staff_rank(sm.user_id)>0;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.label),'[]'::jsonb) into templates from public.support_message_templates t;
  return jsonb_build_object('departments',deps,'staff',people,'templates',templates,
    'hierarchy',jsonb_build_array(
      jsonb_build_object('rank',1,'slug','support','label','Support','description','Worker'),
      jsonb_build_object('rank',2,'slug','senior-support','label','Senior Support','description','Supervisor'),
      jsonb_build_object('rank',3,'slug','admin','label','Administrator','description','Manager'),
      jsonb_build_object('rank',4,'slug','superadmin','label','Superadmin','description','Boss / final escalation')
    ));
end $$;

create or replace function public.admin_save_support_department(
  p_id uuid,p_name text,p_slug text,p_description text,p_email text,p_enabled boolean,
  p_client_can_close boolean,p_auto_close_hours integer,p_sort_order integer
) returns uuid
language plpgsql security definer set search_path='public' as $$
declare did uuid; clean_slug text;
begin
  if not (public.has_permission('support.settings') or public.has_permission('support.departments.manage')) then raise exception 'permission denied: support.departments.manage'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'department name is required'; end if;
  clean_slug:=lower(regexp_replace(coalesce(nullif(trim(p_slug),''),trim(p_name)),'[^a-zA-Z0-9]+','-','g'));
  clean_slug:=trim(both '-' from clean_slug);
  if clean_slug='' then raise exception 'department slug is required'; end if;
  if p_id is null then
    insert into public.support_departments(name,slug,description,email,enabled,client_can_close,auto_close_hours,sort_order)
    values(trim(p_name),clean_slug,nullif(trim(coalesce(p_description,'')),''),nullif(trim(coalesce(p_email,'')),''),coalesce(p_enabled,true),coalesce(p_client_can_close,true),case when p_auto_close_hours is null or p_auto_close_hours<=0 then null else p_auto_close_hours end,coalesce(p_sort_order,100))
    returning id into did;
  else
    update public.support_departments set name=trim(p_name),slug=clean_slug,description=nullif(trim(coalesce(p_description,'')),''),email=nullif(trim(coalesce(p_email,'')),''),enabled=coalesce(p_enabled,true),client_can_close=coalesce(p_client_can_close,true),auto_close_hours=case when p_auto_close_hours is null or p_auto_close_hours<=0 then null else p_auto_close_hours end,sort_order=coalesce(p_sort_order,100),updated_at=now()
    where id=p_id returning id into did;
    if did is null then raise exception 'department not found'; end if;
  end if;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'support.department.save','support_department',did::text,jsonb_build_object('name',trim(p_name),'slug',clean_slug));
  return did;
end $$;

create or replace function public.admin_set_support_department_members(p_department_id uuid,p_user_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare uid uuid; count_added integer:=0;
begin
  if not (public.has_permission('support.settings') or public.has_permission('support.departments.manage')) then raise exception 'permission denied: support.departments.manage'; end if;
  if not exists(select 1 from public.support_departments where id=p_department_id) then raise exception 'department not found'; end if;
  delete from public.support_department_staff where department_id=p_department_id;
  foreach uid in array coalesce(p_user_ids,'{}'::uuid[]) loop
    if public.support_staff_rank(uid)<=0 then raise exception 'user % is not active support staff',uid; end if;
    insert into public.support_department_staff(department_id,user_id,created_by) values(p_department_id,uid,auth.uid()) on conflict do nothing;
    count_added:=count_added+1;
  end loop;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'support.department.members','support_department',p_department_id::text,jsonb_build_object('member_count',count_added,'user_ids',to_jsonb(coalesce(p_user_ids,'{}'::uuid[]))));
  return jsonb_build_object('ok',true,'member_count',count_added);
end $$;

create or replace function public.admin_delete_support_department(p_department_id uuid) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare open_count integer; dname text;
begin
  if not (public.has_permission('support.settings') or public.has_permission('support.departments.manage')) then raise exception 'permission denied: support.departments.manage'; end if;
  select name into dname from public.support_departments where id=p_department_id;
  if dname is null then raise exception 'department not found'; end if;
  select count(*) into open_count from public.support_tickets where department_id=p_department_id and status<>'closed' and archived_at is null;
  if open_count>0 then raise exception 'department has % active ticket(s); move or close them first',open_count; end if;
  delete from public.support_departments where id=p_department_id;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'support.department.delete','support_department',p_department_id::text,jsonb_build_object('name',dname));
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.admin_support_queue_snapshot() returns jsonb
language plpgsql security definer set search_path='public' as $$
declare uid uuid:=auth.uid(); rank integer; tickets jsonb;
begin
  if uid is null or not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
  rank:=public.support_staff_rank(uid);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc),'[]'::jsonb) into tickets
  from (
    select t.id,t.ticket_number,t.user_id,t.department_id,t.assigned_to,t.subject,t.status,t.priority,t.source,t.related_order_id,
      t.last_reply_at,t.created_at,t.updated_at,t.archived_at,t.escalation_level,t.escalation_reason,t.escalated_at,t.escalated_by,
      d.name department_name,coalesce(ap.display_name,trim(concat_ws(' ',ap.first_name,ap.last_name))) assigned_name,
      case t.escalation_level when 3 then 'Superadmin' when 2 then 'Administrator' when 1 then 'Senior Support' else 'Support' end escalation_label
    from public.support_tickets t
    left join public.support_departments d on d.id=t.department_id
    left join public.user_profiles ap on ap.id=t.assigned_to
    where (rank>=3 or t.assigned_to=uid or public.support_user_has_department(uid,t.department_id))
      and t.escalation_level<=greatest(rank-1,0)
  ) x;
  return jsonb_build_object('tickets',tickets,'rank',rank,'rank_label',public.support_staff_rank_label(rank));
end $$;

create or replace function public.admin_create_support_ticket(
  p_user_id uuid,p_department_id uuid,p_subject text,p_priority text,p_body text,p_related_order_id uuid default null
) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare tid uuid; num bigint; mid uuid;
begin
  if not public.has_permission('support.ticket_create') then raise exception 'permission denied: support.ticket_create'; end if;
  if p_user_id is null or not exists(select 1 from public.user_profiles where id=p_user_id) then raise exception 'customer not found'; end if;
  if nullif(trim(coalesce(p_subject,'')),'') is null or nullif(trim(coalesce(p_body,'')),'') is null then raise exception 'subject and message are required'; end if;
  if p_priority not in ('low','normal','high','urgent') then raise exception 'invalid priority'; end if;
  if not exists(select 1 from public.support_departments where id=p_department_id and enabled=true) then raise exception 'invalid department'; end if;
  if p_related_order_id is not null and not exists(select 1 from public.orders where id=p_related_order_id and auth_user_id=p_user_id) then raise exception 'order not found'; end if;
  insert into public.support_tickets(user_id,department_id,subject,status,priority,source,related_order_id,last_staff_reply_at,last_reply_at)
  values(p_user_id,p_department_id,trim(p_subject),'open',p_priority,'admin',p_related_order_id,now(),now())
  returning id,ticket_number into tid,num;
  insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,body,internal_note,attachments)
  values(tid,auth.uid(),public.current_role(),trim(p_body),false,'[]'::jsonb) returning id into mid;
  perform public.support_emit_system_message(tid,'welcome','{}'::jsonb);
  insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
  values(tid,auth.uid(),'admin_created',jsonb_build_object('priority',p_priority,'department_id',p_department_id,'message_id',mid,'customer_id',p_user_id));
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'support.ticket.create','support_ticket',tid::text,jsonb_build_object('ticket_number',num,'customer_id',p_user_id,'department_id',p_department_id));
  return jsonb_build_object('id',tid,'ticket_number',num);
end $$;

create or replace function public.support_emit_system_message(p_ticket uuid,p_event text,p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path='public' as $$
declare t public.support_message_templates%rowtype; txt text;
begin
  select * into t from public.support_message_templates where event_key=p_event and enabled=true;
  if not found then return; end if;
  txt:=t.body;
  txt:=replace(txt,'{{staff}}',coalesce(p_detail->>'staff','Support staff'));
  txt:=replace(txt,'{{department}}',coalesce(p_detail->>'department','Support'));
  txt:=replace(txt,'{{priority}}',coalesce(p_detail->>'priority','normal'));
  txt:=replace(txt,'{{status}}',coalesce(p_detail->>'status','updated'));
  txt:=replace(txt,'{{escalation}}',coalesce(p_detail->>'escalation','Support'));
  txt:=replace(txt,'{{reason}}',coalesce(p_detail->>'reason',''));
  insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,body,internal_note,attachments)
  values(p_ticket,null,'system',txt,not t.customer_visible,'[]'::jsonb);
end $$;

insert into public.support_message_templates(event_key,label,body,enabled,customer_visible,updated_at)
values('escalated','Ticket escalation','Ticket escalated to {{escalation}}. Reason: {{reason}}',true,false,now())
on conflict(event_key) do update set label=excluded.label,body=excluded.body,enabled=true,customer_visible=false,updated_at=now();

create or replace function public.admin_escalate_support_ticket(p_ticket_id uuid,p_target_level integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype; rank integer; target_label text;
begin
  if not public.has_permission('support.escalate') then raise exception 'permission denied: support.escalate'; end if;
  if p_target_level not between 0 and 3 then raise exception 'invalid escalation level'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'escalation reason is required'; end if;
  rank:=public.support_staff_rank(auth.uid());
  select * into t from public.support_tickets where id=p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  if p_target_level>t.escalation_level then
    if p_target_level>least(rank,3) then raise exception 'your support level cannot escalate directly to that tier'; end if;
  elsif p_target_level<t.escalation_level then
    if not public.has_permission('support.escalation.manage') then raise exception 'permission denied: support.escalation.manage'; end if;
    if rank<t.escalation_level+1 then raise exception 'your support level cannot de-escalate this ticket'; end if;
  end if;
  target_label:=case p_target_level when 3 then 'Superadmin' when 2 then 'Administrator' when 1 then 'Senior Support' else 'Support' end;
  update public.support_tickets
  set escalation_level=p_target_level,escalation_reason=trim(p_reason),
      escalated_at=case when p_target_level=0 then null else now() end,
      escalated_by=case when p_target_level=0 then null else auth.uid() end,
      assigned_to=case when p_target_level<>t.escalation_level then null else assigned_to end,
      updated_at=now()
  where id=p_ticket_id;
  perform public.support_emit_system_message(p_ticket_id,'escalated',jsonb_build_object('escalation',target_label,'reason',trim(p_reason),'status','escalated'));
  insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
  values(p_ticket_id,auth.uid(),case when p_target_level>t.escalation_level then 'escalated' when p_target_level<t.escalation_level then 'deescalated' else 'escalation_updated' end,
    jsonb_build_object('from_level',t.escalation_level,'to_level',p_target_level,'target',target_label,'reason',trim(p_reason)));
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'support.escalation','support_ticket',p_ticket_id::text,jsonb_build_object('ticket_number',t.ticket_number,'from_level',t.escalation_level,'to_level',p_target_level,'reason',trim(p_reason)));
  return jsonb_build_object('ok',true,'level',p_target_level,'label',target_label);
end $$;

create or replace function public.admin_update_support_ticket(
  p_ticket_id uuid,p_subject text default null,p_priority text default null,p_department_id uuid default null,
  p_status text default null,p_assigned_to uuid default null,p_assignment_action text default null
) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare old public.support_tickets%rowtype; staff_name text; dept_name text; target_department uuid;
begin
  if not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
  select * into old from public.support_tickets where id=p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  if p_subject is not null and p_subject<>old.subject and not public.has_permission('support.ticket_edit') then raise exception 'permission denied: support.ticket_edit'; end if;
  if p_priority is not null and p_priority<>old.priority and not public.has_permission('support.priority') then raise exception 'permission denied: support.priority'; end if;
  if p_department_id is not null and p_department_id<>old.department_id and not public.has_permission('support.department') then raise exception 'permission denied: support.department'; end if;
  if p_status is not null and p_status<>old.status and not public.has_permission('support.close') then raise exception 'permission denied: support.close'; end if;
  if p_assignment_action='claim' and not public.has_permission('support.claim') then raise exception 'permission denied: support.claim'; end if;
  if p_assignment_action='assign' and not public.has_permission('support.assign') then raise exception 'permission denied: support.assign'; end if;
  if p_assignment_action in ('transfer','unassign') and not public.has_permission('support.transfer') then raise exception 'permission denied: support.transfer'; end if;
  if p_priority is not null and p_priority not in ('low','normal','high','urgent') then raise exception 'invalid priority'; end if;
  if p_status is not null and p_status not in ('open','closed','on_hold','pending','customer_reply','staff_reply') then raise exception 'invalid status'; end if;
  if p_department_id is not null and not exists(select 1 from public.support_departments where id=p_department_id and enabled=true) then raise exception 'invalid department'; end if;
  target_department:=coalesce(p_department_id,old.department_id);
  if p_assigned_to is not null then
    if not exists(select 1 from public.staff_members where user_id=p_assigned_to and status='active') or public.support_staff_rank(p_assigned_to)<=0 then raise exception 'invalid staff member'; end if;
    if public.support_staff_rank(p_assigned_to)<3 and not public.support_user_has_department(p_assigned_to,target_department) then raise exception 'staff member is not assigned to this department'; end if;
    if public.support_staff_rank(p_assigned_to)<=old.escalation_level then raise exception 'staff member is below the ticket escalation tier'; end if;
  end if;
  update public.support_tickets
  set subject=coalesce(p_subject,subject),priority=coalesce(p_priority,priority),department_id=coalesce(p_department_id,department_id),status=coalesce(p_status,status),
      assigned_to=case when p_assignment_action='unassign' then null when p_assigned_to is not null then p_assigned_to else assigned_to end,
      closed_at=case when p_status='closed' then now() when p_status is not null and p_status<>'closed' then null else closed_at end,
      closed_by=case when p_status='closed' then auth.uid() when p_status is not null and p_status<>'closed' then null else closed_by end,
      updated_at=now()
  where id=p_ticket_id;
  if p_priority is not null and p_priority<>old.priority then perform public.support_emit_system_message(p_ticket_id,'priority_changed',jsonb_build_object('priority',p_priority)); end if;
  if p_department_id is not null and p_department_id<>old.department_id then select name into dept_name from public.support_departments where id=p_department_id; perform public.support_emit_system_message(p_ticket_id,'department_changed',jsonb_build_object('department',dept_name)); end if;
  if p_assigned_to is not null and p_assigned_to is distinct from old.assigned_to then select display_name into staff_name from public.user_profiles where id=p_assigned_to; perform public.support_emit_system_message(p_ticket_id,case when p_assignment_action='claim' then 'claimed' when old.assigned_to is null then 'assigned' else 'transferred' end,jsonb_build_object('staff',coalesce(staff_name,'Support staff'))); end if;
  if p_status='closed' and old.status<>'closed' then perform public.support_emit_system_message(p_ticket_id,'closing','{}'::jsonb); end if;
  insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
  values(p_ticket_id,auth.uid(),'ticket_updated',jsonb_build_object('subject',p_subject,'priority',p_priority,'department_id',p_department_id,'status',p_status,'assigned_to',p_assigned_to,'assignment_action',p_assignment_action));
  return jsonb_build_object('ok',true);
end $$;
