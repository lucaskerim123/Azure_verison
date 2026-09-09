-- OrbitFS Support System v2 routing helper
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.
create or replace function public.support_ticket_routing_snapshot(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype; actor_rank integer; deps jsonb; people jsonb;
begin
  if not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
  select * into t from public.support_tickets where id=p_ticket_id;
  if not found then raise exception 'ticket not found'; end if;
  actor_rank:=public.support_staff_rank(auth.uid());
  if actor_rank<3 and t.assigned_to is distinct from auth.uid() and not public.support_user_has_department(auth.uid(),t.department_id) then raise exception 'ticket is outside your support departments'; end if;
  if t.escalation_level>greatest(actor_rank-1,0) then raise exception 'ticket is escalated above your support level'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'description',d.description,'enabled',d.enabled) order by d.sort_order,d.name),'[]'::jsonb) into deps from public.support_departments d where d.enabled=true;
  select coalesce(jsonb_agg(jsonb_build_object('user_id',sm.user_id,'display_name',coalesce(up.display_name,trim(concat_ws(' ',up.first_name,up.last_name)),sm.user_id::text),'title',sm.title,'rank',public.support_staff_rank(sm.user_id),'rank_label',public.support_staff_rank_label(public.support_staff_rank(sm.user_id))) order by public.support_staff_rank(sm.user_id) desc,coalesce(up.display_name,sm.user_id::text)),'[]'::jsonb) into people
  from public.staff_members sm left join public.user_profiles up on up.id=sm.user_id
  where sm.status='active' and public.support_staff_rank(sm.user_id)>t.escalation_level
    and (public.support_staff_rank(sm.user_id)>=3 or public.support_user_has_department(sm.user_id,t.department_id));
  return jsonb_build_object('ticket',jsonb_build_object('id',t.id,'department_id',t.department_id,'assigned_to',t.assigned_to,'escalation_level',t.escalation_level,'escalation_reason',t.escalation_reason,'escalated_at',t.escalated_at,'escalated_by',t.escalated_by),'actor_rank',actor_rank,'actor_rank_label',public.support_staff_rank_label(actor_rank),'departments',deps,'staff',people);
end $$;
