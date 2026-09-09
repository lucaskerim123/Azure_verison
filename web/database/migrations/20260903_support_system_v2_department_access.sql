-- Enforce support department + escalation access for staff.
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.

create or replace function public.support_staff_can_access_ticket(p_ticket_id uuid,p_user_id uuid default auth.uid()) returns boolean
language plpgsql stable security definer set search_path='public' as $$
declare r integer; t public.support_tickets%rowtype;
begin
 if p_user_id is null then return false; end if;
 r:=public.support_staff_rank(p_user_id); if r<=0 then return false; end if;
 select * into t from public.support_tickets where id=p_ticket_id; if not found then return false; end if;
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
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'description',d.description,'slug',d.slug) order by d.sort_order,d.name),'[]'::jsonb) into out
 from public.support_departments d
 where d.enabled=true and (r>=3 or exists(select 1 from public.support_department_staff ds where ds.department_id=d.id and ds.user_id=uid));
 return out;
end $$;

drop policy if exists staff_tickets_read on public.support_tickets;
create policy staff_tickets_read on public.support_tickets for select using (public.support_staff_can_access_ticket(id));
drop policy if exists staff_tickets_update on public.support_tickets;
create policy staff_tickets_update on public.support_tickets for update using (public.support_staff_can_access_ticket(id) and public.has_permission('support.manage')) with check (public.support_staff_can_access_ticket(id) and public.has_permission('support.manage'));
drop policy if exists staff_messages_read on public.support_ticket_messages;
create policy staff_messages_read on public.support_ticket_messages for select using (public.support_staff_can_access_ticket(ticket_id));
drop policy if exists staff_messages_insert on public.support_ticket_messages;
create policy staff_messages_insert on public.support_ticket_messages for insert with check (public.support_staff_can_access_ticket(ticket_id) and public.has_permission('support.reply'));
drop policy if exists support_event_staff on public.support_ticket_events;
create policy support_event_staff on public.support_ticket_events for select using (public.support_staff_can_access_ticket(ticket_id));
drop policy if exists support_attachment_rows_staff on public.support_attachments;
create policy support_attachment_rows_staff on public.support_attachments for all using (public.support_staff_can_access_ticket(ticket_id)) with check (public.support_staff_can_access_ticket(ticket_id));

create or replace function public.support_guard_ticket_staff_update() returns trigger language plpgsql security definer set search_path='public' as $$
begin
 if auth.uid() is not null and auth.uid()<>old.user_id and public.support_staff_rank(auth.uid())>0 and not public.support_staff_can_access_ticket(old.id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
 return new;
end $$;
drop trigger if exists trg_support_guard_staff_update on public.support_tickets;
create trigger trg_support_guard_staff_update before update on public.support_tickets for each row execute function public.support_guard_ticket_staff_update();

create or replace function public.support_guard_staff_message_insert() returns trigger language plpgsql security definer set search_path='public' as $$
declare owner_id uuid;
begin
 if auth.uid() is null then return new; end if;
 select user_id into owner_id from public.support_tickets where id=new.ticket_id;
 if owner_id=auth.uid() then return new; end if;
 if public.support_staff_rank(auth.uid())>0 and not public.support_staff_can_access_ticket(new.ticket_id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
 return new;
end $$;
drop trigger if exists trg_support_guard_staff_message on public.support_ticket_messages;
create trigger trg_support_guard_staff_message before insert on public.support_ticket_messages for each row execute function public.support_guard_staff_message_insert();

create or replace function public.support_emit_system_message(p_ticket uuid,p_event text,p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path='public' as $$
declare t public.support_message_templates%rowtype; txt text; owner_id uuid;
begin
 select user_id into owner_id from public.support_tickets where id=p_ticket; if owner_id is null then raise exception 'ticket not found'; end if;
 if auth.uid() is not null and auth.uid()<>owner_id and public.support_staff_rank(auth.uid())>0 and not public.support_staff_can_access_ticket(p_ticket,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
 select * into t from public.support_message_templates where event_key=p_event and enabled=true; if not found then return; end if;
 txt:=t.body; txt:=replace(txt,'{{staff}}',coalesce(p_detail->>'staff','Support staff')); txt:=replace(txt,'{{department}}',coalesce(p_detail->>'department','Support')); txt:=replace(txt,'{{priority}}',coalesce(p_detail->>'priority','normal')); txt:=replace(txt,'{{status}}',coalesce(p_detail->>'status','updated')); txt:=replace(txt,'{{escalation}}',coalesce(p_detail->>'escalation','Support')); txt:=replace(txt,'{{reason}}',coalesce(p_detail->>'reason',''));
 insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,body,internal_note,attachments) values(p_ticket,null,'system',txt,not t.customer_visible,'[]'::jsonb);
end $$;

create or replace function public.support_ticket_billing_context(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype; o jsonb; items jsonb; invs jsonb;
begin
 if not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
 if not public.support_staff_can_access_ticket(p_ticket_id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
 select * into t from public.support_tickets where id=p_ticket_id; if not found then raise exception 'ticket not found'; end if;
 if t.related_order_id is not null then select to_jsonb(x) into o from (select id,order_number,status,payment_status,fulfillment_status,total_cents,currency,created_at from public.orders where id=t.related_order_id and auth_user_id=t.user_id) x; select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into items from (select id,product_id,product_name,license_product_key,quantity,unit_price_cents,total_cents,service_status,billing_period,next_due_at from public.order_items where order_id=t.related_order_id order by product_name) x; else o=null; items='[]'::jsonb; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into invs from (select id,invoice_number,order_id,status,subtotal_cents,discount_cents,total_cents,paid_cents,currency,due_at,created_at from public.invoices where auth_user_id=t.user_id and (t.related_order_id is null or order_id=t.related_order_id) order by created_at desc limit 30) x;
 return jsonb_build_object('order',o,'items',items,'invoices',invs);
end $$;

create or replace function public.support_ticket_mail_context(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare t public.support_tickets%rowtype; v_email text; v_name text;
begin
 select * into t from public.support_tickets where id=p_ticket_id; if not found then raise exception 'ticket not found'; end if;
 if auth.uid()<>t.user_id then
   if not (public.has_permission('support.manage') or public.has_permission('support.reply') or public.has_permission('support.close')) then raise exception 'permission denied'; end if;
   if not public.support_staff_can_access_ticket(p_ticket_id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
 end if;
 select u.email,coalesce(nullif(p.display_name,''),nullif(concat_ws(' ',p.first_name,p.last_name),''),'Customer') into v_email,v_name from auth.users u left join public.user_profiles p on p.id=u.id where u.id=t.user_id;
 return jsonb_build_object('email',v_email,'customer_name',v_name,'ticket_id',t.id,'ticket_number',t.ticket_number,'subject',t.subject,'status',t.status,'user_id',t.user_id);
end $$;

create or replace function public.admin_create_support_ticket(p_user_id uuid,p_department_id uuid,p_subject text,p_priority text,p_body text,p_related_order_id uuid default null) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare tid uuid; num bigint; mid uuid; r integer;
begin
 if not public.has_permission('support.ticket_create') then raise exception 'permission denied: support.ticket_create'; end if;
 r:=public.support_staff_rank(auth.uid()); if r<3 and not public.support_user_has_department(auth.uid(),p_department_id) then raise exception 'you are not assigned to this support department'; end if;
 if p_user_id is null or not exists(select 1 from public.user_profiles where id=p_user_id) then raise exception 'customer not found'; end if;
 if nullif(trim(coalesce(p_subject,'')),'') is null or nullif(trim(coalesce(p_body,'')),'') is null then raise exception 'subject and message are required'; end if;
 if p_priority not in ('low','normal','high','urgent') then raise exception 'invalid priority'; end if;
 if not exists(select 1 from public.support_departments where id=p_department_id and enabled=true) then raise exception 'invalid department'; end if;
 if p_related_order_id is not null and not exists(select 1 from public.orders where id=p_related_order_id and auth_user_id=p_user_id) then raise exception 'order not found'; end if;
 insert into public.support_tickets(user_id,department_id,subject,status,priority,source,related_order_id,last_staff_reply_at,last_reply_at) values(p_user_id,p_department_id,trim(p_subject),'open',p_priority,'admin',p_related_order_id,now(),now()) returning id,ticket_number into tid,num;
 insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,body,internal_note,attachments) values(tid,auth.uid(),public.current_role(),trim(p_body),false,'[]'::jsonb) returning id into mid;
 perform public.support_emit_system_message(tid,'welcome','{}'::jsonb);
 insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail) values(tid,auth.uid(),'admin_created',jsonb_build_object('priority',p_priority,'department_id',p_department_id,'message_id',mid,'customer_id',p_user_id));
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail) values(auth.uid(),'support.ticket.create','support_ticket',tid::text,jsonb_build_object('ticket_number',num,'customer_id',p_user_id,'department_id',p_department_id));
 return jsonb_build_object('id',tid,'ticket_number',num);
end $$;
