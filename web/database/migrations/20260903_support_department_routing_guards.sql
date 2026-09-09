-- Enforce destination department tier/membership rules and keep routing snapshots tier-aware.

create or replace function public.support_ticket_routing_snapshot(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype; actor_rank integer; deps jsonb; people jsonb;
begin
 if not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
 select * into t from public.support_tickets where id=p_ticket_id; if not found then raise exception 'ticket not found'; end if;
 actor_rank:=public.support_staff_rank(auth.uid());
 if actor_rank<3 and t.assigned_to is distinct from auth.uid() and not public.support_user_has_department(auth.uid(),t.department_id) then raise exception 'ticket is outside your support departments'; end if;
 if t.escalation_level>greatest(actor_rank-1,0) then raise exception 'ticket is escalated above your support level'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'description',d.description,'enabled',d.enabled,'email',d.email,'allow_direct_create',d.allow_direct_create,'min_support_rank',d.min_support_rank) order by d.sort_order,d.name),'[]'::jsonb) into deps
 from public.support_departments d
 where d.enabled=true and actor_rank>=d.min_support_rank and (actor_rank>=3 or public.support_user_has_department(auth.uid(),d.id));
 select coalesce(jsonb_agg(jsonb_build_object('user_id',sm.user_id,'display_name',coalesce(up.display_name,trim(concat_ws(' ',up.first_name,up.last_name)),sm.user_id::text),'title',sm.title,'rank',public.support_staff_rank(sm.user_id),'rank_label',public.support_staff_rank_label(public.support_staff_rank(sm.user_id))) order by public.support_staff_rank(sm.user_id) desc,coalesce(up.display_name,sm.user_id::text)),'[]'::jsonb) into people
 from public.staff_members sm left join public.user_profiles up on up.id=sm.user_id
 where sm.status='active' and public.support_staff_rank(sm.user_id)>t.escalation_level and (public.support_staff_rank(sm.user_id)>=3 or public.support_user_has_department(sm.user_id,t.department_id));
 return jsonb_build_object('ticket',jsonb_build_object('id',t.id,'department_id',t.department_id,'assigned_to',t.assigned_to,'escalation_level',t.escalation_level,'escalation_reason',t.escalation_reason,'escalated_at',t.escalated_at,'escalated_by',t.escalated_by),'actor_rank',actor_rank,'actor_rank_label',public.support_staff_rank_label(actor_rank),'departments',deps,'staff',people);
end $$;

create or replace function public.admin_update_support_ticket(p_ticket_id uuid,p_subject text default null,p_priority text default null,p_department_id uuid default null,p_status text default null,p_assigned_to uuid default null,p_assignment_action text default null) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare old public.support_tickets%rowtype; staff_name text; dept_name text; target_department uuid; actor_rank integer;
begin
 if not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
 select * into old from public.support_tickets where id=p_ticket_id for update; if not found then raise exception 'ticket not found'; end if;
 if not public.support_staff_can_access_ticket(p_ticket_id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
 actor_rank:=public.support_staff_rank(auth.uid());
 if p_subject is not null and p_subject<>old.subject and not public.has_permission('support.ticket_edit') then raise exception 'permission denied: support.ticket_edit'; end if;
 if p_priority is not null and p_priority<>old.priority and not public.has_permission('support.priority') then raise exception 'permission denied: support.priority'; end if;
 if p_department_id is not null and p_department_id<>old.department_id and not public.has_permission('support.department') then raise exception 'permission denied: support.department'; end if;
 if p_status is not null and p_status<>old.status and not public.has_permission('support.close') then raise exception 'permission denied: support.close'; end if;
 if p_assignment_action='claim' and not public.has_permission('support.claim') then raise exception 'permission denied: support.claim'; end if;
 if p_assignment_action='assign' and not public.has_permission('support.assign') then raise exception 'permission denied: support.assign'; end if;
 if p_assignment_action in ('transfer','unassign') and not public.has_permission('support.transfer') then raise exception 'permission denied: support.transfer'; end if;
 if old.escalation_level>0 and old.assigned_to is null and p_assignment_action in ('assign','transfer') then raise exception 'escalated tickets must be claimed by the target support tier before they can be assigned or transferred'; end if;
 if p_assignment_action='claim' then
   if p_assigned_to is distinct from auth.uid() then raise exception 'a ticket can only be claimed by the signed-in staff member'; end if;
   if old.escalation_level>0 and actor_rank<>old.escalation_level+1 then raise exception 'this escalated ticket must be claimed by %',public.support_staff_rank_label(old.escalation_level+1); end if;
 end if;
 if p_priority is not null and p_priority not in ('low','normal','high','urgent') then raise exception 'invalid priority'; end if;
 if p_status is not null and p_status not in ('open','closed','on_hold','pending','customer_reply','staff_reply') then raise exception 'invalid status'; end if;
 if p_department_id is not null and not exists(select 1 from public.support_departments where id=p_department_id and enabled=true) then raise exception 'invalid department'; end if;
 target_department:=coalesce(p_department_id,old.department_id);
 if p_department_id is not null and p_department_id<>old.department_id and actor_rank<3 and not public.support_user_has_department(auth.uid(),p_department_id) then raise exception 'you are not assigned to the destination support department or do not meet its minimum tier'; end if;
 if p_assigned_to is not null then
   if not exists(select 1 from public.staff_members where user_id=p_assigned_to and status='active') or public.support_staff_rank(p_assigned_to)<=0 then raise exception 'invalid staff member'; end if;
   if public.support_staff_rank(p_assigned_to)<3 and not public.support_user_has_department(p_assigned_to,target_department) then raise exception 'staff member is not assigned to this department'; end if;
   if public.support_staff_rank(p_assigned_to)<=old.escalation_level then raise exception 'staff member is below the ticket escalation tier'; end if;
 end if;
 update public.support_tickets set subject=coalesce(p_subject,subject),priority=coalesce(p_priority,priority),department_id=coalesce(p_department_id,department_id),status=coalesce(p_status,status),assigned_to=case when p_assignment_action='unassign' then null when p_assigned_to is not null then p_assigned_to else assigned_to end,closed_at=case when p_status='closed' then now() when p_status is not null and p_status<>'closed' then null else closed_at end,closed_by=case when p_status='closed' then auth.uid() when p_status is not null and p_status<>'closed' then null else closed_by end,updated_at=now() where id=p_ticket_id;
 if p_priority is not null and p_priority<>old.priority then perform public.support_emit_system_message(p_ticket_id,'priority_changed',jsonb_build_object('priority',p_priority)); end if;
 if p_department_id is not null and p_department_id<>old.department_id then select name into dept_name from public.support_departments where id=p_department_id; perform public.support_emit_system_message(p_ticket_id,'department_changed',jsonb_build_object('department',dept_name)); end if;
 if p_assigned_to is not null and p_assigned_to is distinct from old.assigned_to then select display_name into staff_name from public.user_profiles where id=p_assigned_to; perform public.support_emit_system_message(p_ticket_id,case when p_assignment_action='claim' then 'claimed' when old.assigned_to is null then 'assigned' else 'transferred' end,jsonb_build_object('staff',coalesce(staff_name,'Support staff'))); end if;
 if p_status='closed' and old.status<>'closed' then perform public.support_emit_system_message(p_ticket_id,'closing','{}'::jsonb); end if;
 insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail) values(p_ticket_id,auth.uid(),'ticket_updated',jsonb_build_object('subject',p_subject,'priority',p_priority,'department_id',p_department_id,'status',p_status,'assigned_to',p_assigned_to,'assignment_action',p_assignment_action,'claim_required_before',old.escalation_level>0 and old.assigned_to is null));
 return jsonb_build_object('ok',true,'claim_required',old.escalation_level>0 and old.assigned_to is null and p_assignment_action is distinct from 'claim');
end $$;
