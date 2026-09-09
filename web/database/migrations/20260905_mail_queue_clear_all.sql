-- Mail queue operator controls: retry, clear stuck/failed items, and clear all non-sent queue items.
create or replace function public.mail_admin_queue_action(
  p_action text,
  p_outbox_id uuid default null,
  p_log_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare n integer:=0; m integer:=0;
begin
  if not (public.is_staff() and public.has_permission('mail.admin')) then raise exception 'Mail administration denied'; end if;

  if p_action='retry' then
    update public.mail_event_outbox
       set state='pending',attempts=0,next_attempt_at=now(),last_error=null,processed_at=null
     where id=p_outbox_id and state<>'sent';
    get diagnostics n=row_count;
    return jsonb_build_object('ok',n>0,'updated',n);

  elsif p_action='clear' then
    update public.mail_delivery_log l
       set status='cancelled',error=coalesce(l.error,'Cleared from Mail queue by administrator')
     where l.status='preparing'
       and exists(select 1 from public.mail_event_outbox e where e.id=p_outbox_id and e.event_key=l.event_type and e.related_type=l.related_type and e.related_id=l.related_id);
    delete from public.mail_event_outbox where id=p_outbox_id and state<>'sent';
    get diagnostics n=row_count;
    return jsonb_build_object('ok',n>0,'cleared',n);

  elsif p_action='clear_queue' then
    update public.mail_delivery_log l
       set status='cancelled',error=coalesce(l.error,'Queue cleared by administrator')
     where l.status='preparing'
       and exists(
         select 1 from public.mail_event_outbox e
         where e.event_key=l.event_type and e.related_type=l.related_type and e.related_id=l.related_id and e.state<>'sent'
       );
    get diagnostics m=row_count;
    delete from public.mail_event_outbox where state<>'sent';
    get diagnostics n=row_count;
    return jsonb_build_object('ok',true,'cleared_queue_items',n,'cancelled_preparing_logs',m);

  elsif p_action='retry_all' then
    update public.mail_event_outbox
       set state='pending',attempts=0,next_attempt_at=now(),last_error=null,processed_at=null
     where state in ('failed','processing') or (state='pending' and next_attempt_at<now()-interval '5 minutes');
    get diagnostics n=row_count;
    return jsonb_build_object('ok',true,'updated',n);

  elsif p_action='clear_failed' then
    update public.mail_delivery_log set status='cancelled',error=coalesce(error,'Cleared from Mail queue by administrator')
     where status='preparing' and created_at<now()-interval '5 minutes';
    delete from public.mail_event_outbox where state='failed' and attempts>=10;
    get diagnostics n=row_count;
    return jsonb_build_object('ok',true,'cleared',n);

  elsif p_action='clear_log' then
    update public.mail_delivery_log
       set status='cancelled',error=coalesce(error,'Cleared by administrator')
     where id=p_log_id and status='preparing';
    get diagnostics n=row_count;
    return jsonb_build_object('ok',n>0,'updated',n);
  end if;

  raise exception 'Unknown mail queue action';
end
$function$;
