-- Escalated tickets are deliberately unassigned and must be claimed by the target tier.
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.

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
 if p_assigned_to is not null then
   if not exists(select 1 from public.staff_members where user_id=p_assigned_to and status='active') or public.support_staff_rank(p_assigned_to)<=0 then raise exception 'invalid staff member'; end if;
   if public.support_staff_rank(p_assigned_to)<3 and not public.support_user_has_department(p_assigned_to,target_department) then raise exception 'staff member is not assigned to this department'; end if;
   if public.support_staff_rank(p_assigned_to)<=old.escalation_level then raise exception 'staff member is below the ticket escalation tier'; end if;
 end if;
 update public.support_tickets set
   subject=coalesce(p_subject,subject),priority=coalesce(p_priority,priority),department_id=coalesce(p_department_id,department_id),status=coalesce(p_status,status),
   assigned_to=case when p_assignment_action='unassign' then null when p_assigned_to is not null then p_assigned_to else assigned_to end,
   closed_at=case when p_status='closed' then now() when p_status is not null and p_status<>'closed' then null else closed_at end,
   closed_by=case when p_status='closed' then auth.uid() when p_status is not null and p_status<>'closed' then null else closed_by end,
   updated_at=now() where id=p_ticket_id;
 if p_priority is not null and p_priority<>old.priority then perform public.support_emit_system_message(p_ticket_id,'priority_changed',jsonb_build_object('priority',p_priority)); end if;
 if p_department_id is not null and p_department_id<>old.department_id then select name into dept_name from public.support_departments where id=p_department_id; perform public.support_emit_system_message(p_ticket_id,'department_changed',jsonb_build_object('department',dept_name)); end if;
 if p_assigned_to is not null and p_assigned_to is distinct from old.assigned_to then select display_name into staff_name from public.user_profiles where id=p_assigned_to; perform public.support_emit_system_message(p_ticket_id,case when p_assignment_action='claim' then 'claimed' when old.assigned_to is null then 'assigned' else 'transferred' end,jsonb_build_object('staff',coalesce(staff_name,'Support staff'))); end if;
 if p_status='closed' and old.status<>'closed' then perform public.support_emit_system_message(p_ticket_id,'closing','{}'::jsonb); end if;
 insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail) values(p_ticket_id,auth.uid(),'ticket_updated',jsonb_build_object('subject',p_subject,'priority',p_priority,'department_id',p_department_id,'status',p_status,'assigned_to',p_assigned_to,'assignment_action',p_assignment_action,'claim_required_before',old.escalation_level>0 and old.assigned_to is null));
 return jsonb_build_object('ok',true,'claim_required',old.escalation_level>0 and old.assigned_to is null and p_assignment_action is distinct from 'claim');
end $$;

update public.support_message_templates
set body='Ticket escalated to {{escalation}}. This ticket is now unassigned and must be claimed by the {{escalation}} tier before work continues. Reason: {{reason}}',
    customer_visible=false,
    updated_at=now()
where event_key='escalated';