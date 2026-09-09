-- Make the per-department customer close setting authoritative in the database.
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.
create or replace function public.customer_close_support_ticket(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype; can_close boolean;
begin
  select * into t from public.support_tickets where id=p_ticket_id and user_id=auth.uid() for update;
  if not found then raise exception 'ticket not found'; end if;
  if t.status='closed' then return jsonb_build_object('ok',true,'status','closed'); end if;
  select d.client_can_close into can_close from public.support_departments d where d.id=t.department_id;
  if coalesce(can_close,false)=false then raise exception 'this support department requires staff to close the ticket'; end if;
  update public.support_tickets set status='closed',closed_at=now(),closed_by=auth.uid(),updated_at=now() where id=t.id;
  perform public.support_emit_system_message(t.id,'closing','{}'::jsonb);
  insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail) values(t.id,auth.uid(),'customer_closed','{}'::jsonb);
  return jsonb_build_object('ok',true,'status','closed');
end $$;
