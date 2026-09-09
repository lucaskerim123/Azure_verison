-- OrbitFS structured support departments and advanced routing.
-- Customer/staff intake is limited to direct-start departments. Advanced departments are routing-only.

alter table public.support_departments
  add column if not exists allow_direct_create boolean not null default true,
  add column if not exists min_support_rank integer not null default 1,
  add column if not exists escalation_department_id uuid references public.support_departments(id) on delete set null;

do $$ begin
  alter table public.support_departments add constraint support_departments_min_support_rank_check check (min_support_rank between 1 and 4);
exception when duplicate_object then null; end $$;

-- Preserve historical ticket foreign keys by repurposing the original seeded departments.
do $$ begin
  if not exists(select 1 from public.support_departments where slug='general-support') then update public.support_departments set slug='general-support' where slug='general'; end if;
  if not exists(select 1 from public.support_departments where slug='technical-support') then update public.support_departments set slug='technical-support' where slug='licensing'; end if;
  if not exists(select 1 from public.support_departments where slug='billing-enquiries') then update public.support_departments set slug='billing-enquiries' where slug='orders'; end if;
end $$;

insert into public.support_departments(name,slug,description,email,enabled,client_can_close,auto_close_hours,sort_order,allow_direct_create,min_support_rank)
values
 ('General Support','general-support','General account, product and service support.','support@orbitfs.cc',true,true,null,10,true,1),
 ('Advanced General Support','advanced-general-support','Escalated general support handled by Senior Support or higher.','support@orbitfs.cc',true,true,null,20,false,2),
 ('Sales Enquiries','sales-enquiries','Pre-sales, pricing and product purchase enquiries.','billing@orbitfs.cc',true,true,null,30,true,1),
 ('Billing Enquiries','billing-enquiries','Invoices, payments, Wallet, refunds and billing enquiries.','billing@orbitfs.cc',true,true,null,40,true,1),
 ('Technical Support','technical-support','Technical issues, setup and product configuration support.','admin@orbitfs.cc',true,true,null,50,true,1),
 ('Advanced Technical Support','advanced-technical-support','Escalated technical issues handled by Senior Support or higher.','admin@orbitfs.cc',true,true,null,60,false,2)
on conflict(slug) do update set name=excluded.name,description=excluded.description,email=excluded.email,enabled=true,sort_order=excluded.sort_order,allow_direct_create=excluded.allow_direct_create,min_support_rank=excluded.min_support_rank,updated_at=now();

update public.support_departments b set escalation_department_id=a.id,updated_at=now() from public.support_departments a where b.slug='general-support' and a.slug='advanced-general-support';
update public.support_departments b set escalation_department_id=a.id,updated_at=now() from public.support_departments a where b.slug='technical-support' and a.slug='advanced-technical-support';
update public.support_departments set escalation_department_id=null,updated_at=now() where slug in ('advanced-general-support','sales-enquiries','billing-enquiries','advanced-technical-support');

delete from public.support_departments d where d.slug not in ('general-support','advanced-general-support','sales-enquiries','billing-enquiries','technical-support','advanced-technical-support') and not exists(select 1 from public.support_tickets t where t.department_id=d.id);
update public.support_departments set enabled=false,allow_direct_create=false,updated_at=now() where slug not in ('general-support','advanced-general-support','sales-enquiries','billing-enquiries','technical-support','advanced-technical-support');

create or replace function public.support_user_has_department(p_user_id uuid,p_department_id uuid) returns boolean
language plpgsql stable security definer set search_path='public' as $$
declare r integer; min_rank integer;
begin
 r:=public.support_staff_rank(p_user_id);
 select min_support_rank into min_rank from public.support_departments where id=p_department_id and enabled=true;
 if min_rank is null or r<min_rank then return false; end if;
 if r>=3 then return true; end if;
 return exists(select 1 from public.support_department_staff ds where ds.user_id=p_user_id and ds.department_id=p_department_id);
end $$;

create or replace function public.support_staff_can_access_ticket(p_ticket_id uuid,p_user_id uuid default auth.uid()) returns boolean
language plpgsql stable security definer set search_path='public' as $$
declare r integer; t public.support_tickets%rowtype; min_rank integer;
begin
 if p_user_id is null then return false; end if;
 r:=public.support_staff_rank(p_user_id); if r<=0 then return false; end if;
 select * into t from public.support_tickets where id=p_ticket_id; if not found then return false; end if;
 select min_support_rank into min_rank from public.support_departments where id=t.department_id;
 if r<coalesce(min_rank,1) then return false; end if;
 if r>=3 then return true; end if;
 if t.escalation_level>greatest(r-1,0) then return false; end if;
 return t.assigned_to=p_user_id or public.support_user_has_department(p_user_id,t.department_id);
end $$;

create or replace function public.support_staff_departments() returns jsonb
language plpgsql stable security definer set search_path='public' as $$
declare uid uuid:=auth.uid(); r integer; out jsonb;
begin
 if uid is null or not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
 r:=public.support_staff_rank(uid);
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'description',d.description,'slug',d.slug,'email',d.email,'allow_direct_create',d.allow_direct_create,'min_support_rank',d.min_support_rank,'escalation_department_id',d.escalation_department_id) order by d.sort_order,d.name),'[]'::jsonb) into out
 from public.support_departments d where d.enabled=true and r>=d.min_support_rank and (r>=3 or exists(select 1 from public.support_department_staff ds where ds.department_id=d.id and ds.user_id=uid));
 return out;
end $$;

create or replace function public.admin_support_settings_snapshot() returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare deps jsonb; people jsonb; templates jsonb;
begin
 if not (public.has_permission('support.settings') or public.has_permission('support.departments.manage')) then raise exception 'permission denied: support.departments.manage'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'slug',d.slug,'description',d.description,'email',d.email,'enabled',d.enabled,'client_can_close',d.client_can_close,'auto_close_hours',d.auto_close_hours,'sort_order',d.sort_order,'allow_direct_create',d.allow_direct_create,'min_support_rank',d.min_support_rank,'escalation_department_id',d.escalation_department_id,'member_ids',coalesce((select jsonb_agg(ds.user_id order by ds.created_at) from public.support_department_staff ds where ds.department_id=d.id),'[]'::jsonb)) order by d.sort_order,d.name),'[]'::jsonb) into deps from public.support_departments d where d.enabled=true;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',sm.user_id,'display_name',coalesce(up.display_name,trim(concat_ws(' ',up.first_name,up.last_name)),au.email,sm.user_id::text),'email',au.email,'title',sm.title,'status',sm.status,'rank',public.support_staff_rank(sm.user_id),'rank_label',public.support_staff_rank_label(public.support_staff_rank(sm.user_id))) order by public.support_staff_rank(sm.user_id) desc,coalesce(up.display_name,au.email)),'[]'::jsonb) into people from public.staff_members sm left join public.user_profiles up on up.id=sm.user_id left join auth.users au on au.id=sm.user_id where sm.status='active' and public.support_staff_rank(sm.user_id) in (1,2);
 select coalesce(jsonb_agg(to_jsonb(t) order by t.label),'[]'::jsonb) into templates from public.support_message_templates t;
 return jsonb_build_object('departments',deps,'staff',people,'templates',templates,'hierarchy',jsonb_build_array(jsonb_build_object('rank',1,'slug','support','label','Support','description','Worker'),jsonb_build_object('rank',2,'slug','senior-support','label','Senior Support','description','Supervisor'),jsonb_build_object('rank',3,'slug','admin','label','Admin','description','Manager'),jsonb_build_object('rank',4,'slug','superadmin','label','Superadmin','description','Boss / final escalation')));
end $$;

create or replace function public.admin_set_support_department_members(p_department_id uuid,p_user_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare uid uuid; count_added integer:=0; r integer; min_rank integer;
begin
 if not (public.has_permission('support.settings') or public.has_permission('support.departments.manage')) then raise exception 'permission denied: support.departments.manage'; end if;
 select min_support_rank into min_rank from public.support_departments where id=p_department_id; if min_rank is null then raise exception 'department not found'; end if;
 delete from public.support_department_staff where department_id=p_department_id;
 foreach uid in array coalesce(p_user_ids,'{}'::uuid[]) loop
   r:=public.support_staff_rank(uid);
   if r not in (1,2) then raise exception 'department membership is only for Support and Senior Support staff'; end if;
   if r<min_rank then raise exception '% requires % or higher',p_department_id,public.support_staff_rank_label(min_rank); end if;
   insert into public.support_department_staff(department_id,user_id,created_by) values(p_department_id,uid,auth.uid()) on conflict do nothing; count_added:=count_added+1;
 end loop;
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail) values(auth.uid(),'support.department.members','support_department',p_department_id::text,jsonb_build_object('member_count',count_added,'user_ids',to_jsonb(coalesce(p_user_ids,'{}'::uuid[]))));
 return jsonb_build_object('ok',true,'member_count',count_added);
end $$;

create or replace function public.admin_set_support_department_routing(p_department_id uuid,p_allow_direct_create boolean,p_min_support_rank integer,p_escalation_department_id uuid default null) returns jsonb
language plpgsql security definer set search_path='public' as $$
begin
 if not (public.has_permission('support.settings') or public.has_permission('support.departments.manage')) then raise exception 'permission denied: support.departments.manage'; end if;
 if p_min_support_rank not between 1 and 4 then raise exception 'minimum support tier must be between 1 and 4'; end if;
 if p_escalation_department_id=p_department_id then raise exception 'department cannot escalate to itself'; end if;
 if p_escalation_department_id is not null and not exists(select 1 from public.support_departments where id=p_escalation_department_id and enabled=true) then raise exception 'escalation department not found'; end if;
 update public.support_departments set allow_direct_create=coalesce(p_allow_direct_create,true),min_support_rank=p_min_support_rank,escalation_department_id=p_escalation_department_id,updated_at=now() where id=p_department_id;
 if not found then raise exception 'department not found'; end if;
 delete from public.support_department_staff ds where ds.department_id=p_department_id and public.support_staff_rank(ds.user_id)<p_min_support_rank;
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail) values(auth.uid(),'support.department.routing','support_department',p_department_id::text,jsonb_build_object('allow_direct_create',p_allow_direct_create,'min_support_rank',p_min_support_rank,'escalation_department_id',p_escalation_department_id));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.create_support_ticket(p_department_id uuid,p_subject text,p_priority text,p_body text,p_related_order_id uuid default null) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare uid uuid:=auth.uid(); tid uuid; num bigint; mid uuid;
begin
 if uid is null then raise exception 'authentication required'; end if;
 if coalesce(trim(p_subject),'')='' or coalesce(trim(p_body),'')='' then raise exception 'subject and message are required'; end if;
 if p_priority not in ('low','normal','high','urgent') then raise exception 'invalid priority'; end if;
 if not exists(select 1 from public.support_departments where id=p_department_id and enabled=true and allow_direct_create=true) then raise exception 'this department cannot be selected when opening a ticket'; end if;
 if p_related_order_id is not null and not exists(select 1 from public.orders where id=p_related_order_id and auth_user_id=uid) then raise exception 'order not found'; end if;
 insert into public.support_tickets(user_id,department_id,subject,status,priority,source,related_order_id,last_client_reply_at,last_reply_at) values(uid,p_department_id,trim(p_subject),'open',p_priority,'portal',p_related_order_id,now(),now()) returning id,ticket_number into tid,num;
 insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,body,internal_note,attachments) values(tid,uid,'user',p_body,false,'[]'::jsonb) returning id into mid;
 perform public.support_emit_system_message(tid,'welcome','{}'::jsonb);
 insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail) values(tid,uid,'created',jsonb_build_object('priority',p_priority,'department_id',p_department_id,'message_id',mid));
 return jsonb_build_object('id',tid,'ticket_number',num);
end $$;

create or replace function public.admin_create_support_ticket(p_user_id uuid,p_department_id uuid,p_subject text,p_priority text,p_body text,p_related_order_id uuid default null) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare tid uuid; num bigint; mid uuid; r integer;
begin
 if not public.has_permission('support.ticket_create') then raise exception 'permission denied: support.ticket_create'; end if;
 r:=public.support_staff_rank(auth.uid());
 if not exists(select 1 from public.support_departments where id=p_department_id and enabled=true and allow_direct_create=true and r>=min_support_rank) then raise exception 'this department cannot be selected when creating a ticket'; end if;
 if r<3 and not public.support_user_has_department(auth.uid(),p_department_id) then raise exception 'you are not assigned to this support department'; end if;
 if p_user_id is null or not exists(select 1 from public.user_profiles where id=p_user_id) then raise exception 'customer not found'; end if;
 if nullif(trim(coalesce(p_subject,'')),'') is null or nullif(trim(coalesce(p_body,'')),'') is null then raise exception 'subject and message are required'; end if;
 if p_priority not in ('low','normal','high','urgent') then raise exception 'invalid priority'; end if;
 if p_related_order_id is not null and not exists(select 1 from public.orders where id=p_related_order_id and auth_user_id=p_user_id) then raise exception 'order not found'; end if;
 insert into public.support_tickets(user_id,department_id,subject,status,priority,source,related_order_id,last_staff_reply_at,last_reply_at) values(p_user_id,p_department_id,trim(p_subject),'open',p_priority,'admin',p_related_order_id,now(),now()) returning id,ticket_number into tid,num;
 insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,body,internal_note,attachments) values(tid,auth.uid(),public.current_role(),trim(p_body),false,'[]'::jsonb) returning id into mid;
 perform public.support_emit_system_message(tid,'welcome','{}'::jsonb);
 insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail) values(tid,auth.uid(),'admin_created',jsonb_build_object('priority',p_priority,'department_id',p_department_id,'message_id',mid,'customer_id',p_user_id));
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail) values(auth.uid(),'support.ticket.create','support_ticket',tid::text,jsonb_build_object('ticket_number',num,'customer_id',p_user_id,'department_id',p_department_id));
 return jsonb_build_object('id',tid,'ticket_number',num);
end $$;

create or replace function public.admin_escalate_support_ticket(p_ticket_id uuid,p_target_level integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype; rank integer; target_label text; new_department uuid; mapped uuid;
begin
 if not public.has_permission('support.escalate') then raise exception 'permission denied: support.escalate'; end if;
 if p_target_level not between 0 and 3 then raise exception 'invalid escalation level'; end if;
 if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'escalation reason is required'; end if;
 rank:=public.support_staff_rank(auth.uid()); select * into t from public.support_tickets where id=p_ticket_id for update; if not found then raise exception 'ticket not found'; end if;
 if not public.support_staff_can_access_ticket(p_ticket_id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
 if p_target_level>t.escalation_level then if p_target_level<>t.escalation_level+1 then raise exception 'tickets must escalate one support level at a time'; end if; if p_target_level>least(rank,3) then raise exception 'your support level cannot escalate to that tier'; end if;
 elsif p_target_level<t.escalation_level then if p_target_level<>t.escalation_level-1 then raise exception 'tickets must de-escalate one support level at a time'; end if; if not public.has_permission('support.escalation.manage') then raise exception 'permission denied: support.escalation.manage'; end if; if rank<t.escalation_level+1 then raise exception 'your support level cannot de-escalate this ticket'; end if; end if;
 target_label:=case p_target_level when 3 then 'Superadmin' when 2 then 'Admin' when 1 then 'Senior Support' else 'Support' end;
 new_department:=t.department_id;
 if p_target_level>t.escalation_level then select escalation_department_id into mapped from public.support_departments where id=t.department_id; if mapped is not null then new_department:=mapped; end if;
 elsif p_target_level=0 and p_target_level<t.escalation_level then select id into mapped from public.support_departments where escalation_department_id=t.department_id and enabled=true order by sort_order limit 1; if mapped is not null then new_department:=mapped; end if; end if;
 perform public.support_emit_system_message(p_ticket_id,'escalated',jsonb_build_object('escalation',target_label,'reason',trim(p_reason),'status','escalated'));
 update public.support_tickets set escalation_level=p_target_level,escalation_reason=trim(p_reason),department_id=new_department,escalated_at=case when p_target_level=0 then null else now() end,escalated_by=case when p_target_level=0 then null else auth.uid() end,assigned_to=case when p_target_level<>t.escalation_level then null else assigned_to end,updated_at=now() where id=p_ticket_id;
 insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail) values(p_ticket_id,auth.uid(),case when p_target_level>t.escalation_level then 'escalated' when p_target_level<t.escalation_level then 'deescalated' else 'escalation_updated' end,jsonb_build_object('from_level',t.escalation_level,'to_level',p_target_level,'target',target_label,'reason',trim(p_reason),'from_department_id',t.department_id,'to_department_id',new_department,'claim_required',p_target_level<>t.escalation_level));
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail) values(auth.uid(),'support.escalation','support_ticket',p_ticket_id::text,jsonb_build_object('ticket_number',t.ticket_number,'from_level',t.escalation_level,'to_level',p_target_level,'reason',trim(p_reason),'from_department_id',t.department_id,'to_department_id',new_department));
 return jsonb_build_object('ok',true,'level',p_target_level,'label',target_label,'department_id',new_department,'claim_required',p_target_level<>t.escalation_level);
end $$;

create or replace function public.support_ticket_mail_context(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare t public.support_tickets%rowtype; v_email text; v_name text; v_department_email text; v_department_name text;
begin
 select * into t from public.support_tickets where id=p_ticket_id; if not found then raise exception 'ticket not found'; end if;
 if auth.uid()<>t.user_id then if not (public.has_permission('support.manage') or public.has_permission('support.reply') or public.has_permission('support.close')) then raise exception 'permission denied'; end if; if not public.support_staff_can_access_ticket(p_ticket_id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if; end if;
 select u.email,coalesce(nullif(p.display_name,''),nullif(concat_ws(' ',p.first_name,p.last_name),''),'Customer') into v_email,v_name from auth.users u left join public.user_profiles p on p.id=u.id where u.id=t.user_id;
 select d.email,d.name into v_department_email,v_department_name from public.support_departments d where d.id=t.department_id;
 return jsonb_build_object('email',v_email,'customer_name',v_name,'ticket_id',t.id,'ticket_number',t.ticket_number,'subject',t.subject,'status',t.status,'user_id',t.user_id,'department_id',t.department_id,'department_name',v_department_name,'department_email',v_department_email);
end $$;

-- Automated support-ticket mail uses the department mailbox instead of a single global support sender.
create or replace function public.mail_outbox_prepare(p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare e public.mail_event_outbox%rowtype; a public.mail_automations%rowtype; t public.mail_templates%rowtype; c public.customers%rowtype; p public.user_profiles%rowtype; o public.orders%rowtype; i public.invoices%rowtype; cr public.order_cancellation_requests%rowtype; st public.support_tickets%rowtype; v_vars jsonb; v_recipient text; v_name text; v_sender text; v_log uuid:=gen_random_uuid(); v_ref text:='OFM-'||upper(substr(replace(v_log::text,'-',''),1,8)); v_site text:='https://orbitfs.vercel.app';
begin
 select * into e from public.mail_event_outbox where id=p_id and dispatch_token=p_token for update; if not found then raise exception 'invalid mail dispatch'; end if;
 if e.state='sent' then return jsonb_build_object('skip',true,'reason','already_processed'); end if;
 if exists(select 1 from public.mail_delivery_log l where l.event_type=e.event_key and l.related_type=e.related_type and l.related_id=e.related_id and l.status='sent' and l.created_at>=e.created_at-interval '2 minutes') then update public.mail_event_outbox set state='sent',processed_at=now(),last_error=null where id=e.id; return jsonb_build_object('skip',true,'reason','already_delivered'); end if;
 select * into a from public.mail_automations where event_key=e.event_key and enabled=true; if not found or a.template_key is null then raise exception 'mail automation missing or disabled: %',e.event_key; end if;
 select * into t from public.mail_templates where template_key=a.template_key and enabled=true; if not found then raise exception 'mail template missing or disabled: %',a.template_key; end if;
 v_sender:=t.from_account;
 if e.auth_user_id is not null then select * into c from public.customers where auth_user_id=e.auth_user_id limit 1; select * into p from public.user_profiles where id=e.auth_user_id; end if;
 v_recipient:=c.email; v_name:=coalesce(nullif(c.name,''),nullif(p.display_name,''),nullif(concat_ws(' ',p.first_name,p.last_name),''),'Customer'); v_vars:=coalesce(e.payload,'{}'::jsonb)||jsonb_build_object('customer_name',v_name);
 if e.related_type='order' then select * into o from public.orders where id=e.related_id::uuid; v_vars:=v_vars||jsonb_build_object('order_number',coalesce(o.order_number,''),'order_total',to_char(coalesce(o.total_cents,0)::numeric/100,'FM$999999990.00'),'reason',coalesce(v_vars->>'reason',o.termination_reason,''));
 elsif e.related_type='invoice' then select * into i from public.invoices where id=e.related_id::uuid; v_vars:=v_vars||jsonb_build_object('invoice_number',coalesce(i.invoice_number,''),'invoice_total',to_char(coalesce(i.total_cents,0)::numeric/100,'FM$999999990.00'),'invoice_due',to_char(greatest(0,coalesce(i.total_cents,0)-coalesce(i.paid_cents,0))::numeric/100,'FM$999999990.00'),'due_date',coalesce(to_char(i.due_at at time zone 'Australia/Sydney','DD/MM/YYYY'),'No due date'),'invoice_url',v_site||'/portal/invoices/'||i.id::text);
 elsif e.related_type='cancellation' then select * into cr from public.order_cancellation_requests where id=e.related_id::uuid; select * into o from public.orders where id=cr.order_id; v_vars:=v_vars||jsonb_build_object('order_number',coalesce(o.order_number,''),'reason',coalesce(cr.reason,''),'staff_note',coalesce(nullif(cr.staff_note,''),'No additional note was provided.'),'scheduled_for',coalesce(to_char(cr.scheduled_for at time zone 'Australia/Sydney','DD/MM/YYYY HH24:MI'),''));
 elsif e.related_type='support_ticket' then select * into st from public.support_tickets where id=e.related_id::uuid; select coalesce(d.email,t.from_account) into v_sender from public.support_departments d where d.id=st.department_id; v_sender:=coalesce(v_sender,t.from_account); v_vars:=v_vars||jsonb_build_object('ticket_number',coalesce(st.ticket_number::text,''),'ticket_subject',coalesce(st.subject,''),'reply_preview',coalesce(v_vars->>'reply_preview',''),'ticket_url',v_site||'/portal/support/'||st.id::text); end if;
 if coalesce(v_recipient,'')='' then raise exception 'customer email unavailable'; end if;
 insert into public.mail_delivery_log(id,provider_id,template_key,event_type,related_type,related_id,recipient,sender,subject,status,error,sent_at,reference_id,sent_by_user_id,sent_by_email,sent_by_name) values(v_log,null,t.template_key,e.event_key,e.related_type,e.related_id,v_recipient,v_sender,t.subject,'preparing',null,null,v_ref,null,'system@orbitfs.cc','System Automation');
 update public.mail_event_outbox set state='processing',last_error=null,next_attempt_at=now()+interval '5 minutes' where id=e.id;
 return jsonb_build_object('skip',false,'outbox_id',e.id,'log_id',v_log,'reference_id',v_ref,'event_key',e.event_key,'related_type',e.related_type,'related_id',e.related_id,'recipient',v_recipient,'template_key',t.template_key,'from_account',v_sender,'subject',t.subject,'text_body',t.text_body,'html',t.html,'vars',v_vars);
end $$;
