-- Escalation finalisation: write the timeline message before the actor loses access to the raised tier.
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.
create or replace function public.admin_escalate_support_ticket(p_ticket_id uuid,p_target_level integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype; rank integer; target_label text;
begin
  if not public.has_permission('support.escalate') then raise exception 'permission denied: support.escalate'; end if;
  if p_target_level not between 0 and 3 then raise exception 'invalid escalation level'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'escalation reason is required'; end if;
  rank:=public.support_staff_rank(auth.uid());
  select * into t from public.support_tickets where id=p_ticket_id for update; if not found then raise exception 'ticket not found'; end if;
  if not public.support_staff_can_access_ticket(p_ticket_id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
  if p_target_level>t.escalation_level then
    if p_target_level<>t.escalation_level+1 then raise exception 'tickets must escalate one support level at a time'; end if;
    if p_target_level>least(rank,3) then raise exception 'your support level cannot escalate to that tier'; end if;
  elsif p_target_level<t.escalation_level then
    if p_target_level<>t.escalation_level-1 then raise exception 'tickets must de-escalate one support level at a time'; end if;
    if not public.has_permission('support.escalation.manage') then raise exception 'permission denied: support.escalation.manage'; end if;
    if rank<t.escalation_level+1 then raise exception 'your support level cannot de-escalate this ticket'; end if;
  end if;
  target_label:=case p_target_level when 3 then 'Superadmin' when 2 then 'Admin' when 1 then 'Senior Support' else 'Support' end;
  perform public.support_emit_system_message(p_ticket_id,'escalated',jsonb_build_object('escalation',target_label,'reason',trim(p_reason),'status','escalated'));
  update public.support_tickets set escalation_level=p_target_level,escalation_reason=trim(p_reason),escalated_at=case when p_target_level=0 then null else now() end,escalated_by=case when p_target_level=0 then null else auth.uid() end,assigned_to=case when p_target_level<>t.escalation_level then null else assigned_to end,updated_at=now() where id=p_ticket_id;
  insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail) values(p_ticket_id,auth.uid(),case when p_target_level>t.escalation_level then 'escalated' when p_target_level<t.escalation_level then 'deescalated' else 'escalation_updated' end,jsonb_build_object('from_level',t.escalation_level,'to_level',p_target_level,'target',target_label,'reason',trim(p_reason)));
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail) values(auth.uid(),'support.escalation','support_ticket',p_ticket_id::text,jsonb_build_object('ticket_number',t.ticket_number,'from_level',t.escalation_level,'to_level',p_target_level,'reason',trim(p_reason)));
  return jsonb_build_object('ok',true,'level',p_target_level,'label',target_label);
end $$;
