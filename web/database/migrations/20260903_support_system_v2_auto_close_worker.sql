-- Make support_departments.auto_close_hours operational.
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.
-- Only tickets waiting on the customer are automatically closed.

insert into public.support_message_templates(event_key,label,body,enabled,customer_visible,updated_at)
values(
  'auto_closed',
  'Ticket automatically closed',
  'This ticket was automatically closed after the configured customer-response window expired. Reply to the ticket if you still need help and it will reopen.',
  true,
  true,
  now()
)
on conflict(event_key) do update
set label=excluded.label,body=excluded.body,enabled=excluded.enabled,customer_visible=excluded.customer_visible,updated_at=now();

create or replace function public.process_support_auto_close() returns jsonb
language plpgsql security definer set search_path='public' as $$
declare r record; closed_count integer:=0;
begin
  for r in
    select t.id,t.ticket_number,t.user_id,d.auto_close_hours
    from public.support_tickets t
    join public.support_departments d on d.id=t.department_id
    where d.enabled=true
      and d.auto_close_hours is not null
      and d.auto_close_hours>0
      and t.archived_at is null
      and t.status='customer_reply'
      and t.last_staff_reply_at is not null
      and t.last_staff_reply_at <= now() - make_interval(hours=>d.auto_close_hours)
      and (t.last_client_reply_at is null or t.last_client_reply_at<=t.last_staff_reply_at)
    order by t.last_staff_reply_at
    for update of t skip locked
  loop
    update public.support_tickets
      set status='closed',closed_at=now(),closed_by=null,updated_at=now()
      where id=r.id and status='customer_reply';
    if found then
      perform public.support_emit_system_message(r.id,'auto_closed','{}'::jsonb);
      insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
      values(r.id,null,'auto_closed',jsonb_build_object('auto_close_hours',r.auto_close_hours,'ticket_number',r.ticket_number));
      closed_count:=closed_count+1;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'closed_count',closed_count,'processed_at',now());
end $$;

do $$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='orbitfs-support-auto-close' limit 1;
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule('orbitfs-support-auto-close','37 * * * *','select public.process_support_auto_close()');
end $$;
