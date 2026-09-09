-- One canonical Store URL for all customer-facing mail links.

insert into public.app_settings(key,value,category,public_read,updated_at)
values('site.public_url',to_jsonb('https://orbitfs.cc'::text),'customization',true,now())
on conflict(key) do update
set value=excluded.value,category=excluded.category,public_read=true,updated_at=now();

create or replace function public.dispatch_mail_event_outbox()
returns integer
language plpgsql
security definer
set search_path to 'public','net'
as $$
declare
  r record;
  n integer:=0;
  v_site text;
begin
  select rtrim(coalesce(value #>> '{}','https://orbitfs.cc'),'/')
    into v_site
    from public.app_settings
    where key='site.public_url';
  v_site:=coalesce(nullif(v_site,''),'https://orbitfs.cc');

  update public.mail_event_outbox
    set state='failed',last_error=coalesce(last_error,'Processing timed out'),next_attempt_at=now()
    where state='processing' and next_attempt_at<=now();

  for r in
    select id,dispatch_token
    from public.mail_event_outbox
    where state in ('pending','failed') and next_attempt_at<=now() and attempts<10
    order by created_at
    limit 25
    for update skip locked
  loop
    update public.mail_event_outbox
      set attempts=attempts+1,next_attempt_at=now()+interval '5 minutes'
      where id=r.id;
    perform net.http_post(
      url:=v_site||'/api/mail/outbox',
      body:=jsonb_build_object('id',r.id,'token',r.dispatch_token),
      headers:='{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds:=15000
    );
    n:=n+1;
  end loop;
  return n;
end
$$;

create or replace function public.mail_outbox_prepare(p_id uuid,p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  e public.mail_event_outbox%rowtype;
  a public.mail_automations%rowtype;
  t public.mail_templates%rowtype;
  c public.customers%rowtype;
  p public.user_profiles%rowtype;
  o public.orders%rowtype;
  i public.invoices%rowtype;
  cr public.order_cancellation_requests%rowtype;
  st public.support_tickets%rowtype;
  v_vars jsonb;
  v_recipient text;
  v_name text;
  v_sender text;
  v_log uuid:=gen_random_uuid();
  v_ref text:='OFM-'||upper(substr(replace(v_log::text,'-',''),1,8));
  v_site text;
begin
  select rtrim(coalesce(value #>> '{}','https://orbitfs.cc'),'/')
    into v_site
    from public.app_settings
    where key='site.public_url';
  v_site:=coalesce(nullif(v_site,''),'https://orbitfs.cc');

  select * into e from public.mail_event_outbox where id=p_id and dispatch_token=p_token for update;
  if not found then raise exception 'invalid mail dispatch'; end if;
  if e.state='sent' then return jsonb_build_object('skip',true,'reason','already_processed'); end if;

  if exists(
    select 1 from public.mail_delivery_log l
    where l.event_type=e.event_key
      and l.related_type=e.related_type
      and l.related_id=e.related_id
      and l.status='sent'
      and l.created_at>=e.created_at-interval '2 minutes'
  ) then
    update public.mail_event_outbox set state='sent',processed_at=now(),last_error=null where id=e.id;
    return jsonb_build_object('skip',true,'reason','already_delivered');
  end if;

  select * into a from public.mail_automations where event_key=e.event_key and enabled=true;
  if not found or a.template_key is null then raise exception 'mail automation missing or disabled: %',e.event_key; end if;
  select * into t from public.mail_templates where template_key=a.template_key and enabled=true;
  if not found then raise exception 'mail template missing or disabled: %',a.template_key; end if;

  v_sender:=t.from_account;
  if e.auth_user_id is not null then
    select * into c from public.customers where auth_user_id=e.auth_user_id limit 1;
    select * into p from public.user_profiles where id=e.auth_user_id;
  end if;
  v_recipient:=c.email;
  v_name:=coalesce(nullif(c.name,''),nullif(p.display_name,''),nullif(concat_ws(' ',p.first_name,p.last_name),''),'Customer');
  v_vars:=coalesce(e.payload,'{}'::jsonb)||jsonb_build_object('customer_name',v_name,'site_url',v_site);

  if e.related_type='order' then
    select * into o from public.orders where id=e.related_id::uuid;
    v_vars:=v_vars||jsonb_build_object(
      'order_number',coalesce(o.order_number,''),
      'order_total',to_char(coalesce(o.total_cents,0)::numeric/100,'FM$999999990.00'),
      'reason',coalesce(v_vars->>'reason',o.termination_reason,'')
    );
  elsif e.related_type='invoice' then
    select * into i from public.invoices where id=e.related_id::uuid;
    v_vars:=v_vars||jsonb_build_object(
      'invoice_number',coalesce(i.invoice_number,''),
      'invoice_total',to_char(coalesce(i.total_cents,0)::numeric/100,'FM$999999990.00'),
      'invoice_due',to_char(greatest(0,coalesce(i.total_cents,0)-coalesce(i.paid_cents,0))::numeric/100,'FM$999999990.00'),
      'due_date',coalesce(to_char(i.due_at at time zone 'Australia/Sydney','DD/MM/YYYY'),'No due date'),
      'invoice_url',v_site||'/portal/invoices/'||i.id::text
    );
  elsif e.related_type='cancellation' then
    select * into cr from public.order_cancellation_requests where id=e.related_id::uuid;
    select * into o from public.orders where id=cr.order_id;
    v_vars:=v_vars||jsonb_build_object(
      'order_number',coalesce(o.order_number,''),
      'reason',coalesce(cr.reason,''),
      'staff_note',coalesce(nullif(cr.staff_note,''),'No additional note was provided.'),
      'scheduled_for',coalesce(to_char(cr.scheduled_for at time zone 'Australia/Sydney','DD/MM/YYYY HH24:MI'),'')
    );
  elsif e.related_type='support_ticket' then
    select * into st from public.support_tickets where id=e.related_id::uuid;
    select coalesce(d.email,t.from_account) into v_sender from public.support_departments d where d.id=st.department_id;
    v_sender:=coalesce(v_sender,t.from_account);
    v_vars:=v_vars||jsonb_build_object(
      'ticket_number',coalesce(st.ticket_number::text,''),
      'ticket_subject',coalesce(st.subject,''),
      'reply_preview',coalesce(v_vars->>'reply_preview',''),
      'ticket_url',v_site||'/portal/support/'||st.id::text
    );
  end if;

  if coalesce(v_recipient,'')='' then raise exception 'customer email unavailable'; end if;

  insert into public.mail_delivery_log(
    id,provider_id,template_key,event_type,related_type,related_id,recipient,sender,subject,status,error,sent_at,reference_id,sent_by_user_id,sent_by_email,sent_by_name
  ) values(
    v_log,null,t.template_key,e.event_key,e.related_type,e.related_id,v_recipient,v_sender,t.subject,'preparing',null,null,v_ref,null,'system@orbitfs.cc','System Automation'
  );

  update public.mail_event_outbox
    set state='processing',last_error=null,next_attempt_at=now()+interval '5 minutes'
    where id=e.id;

  return jsonb_build_object(
    'skip',false,'outbox_id',e.id,'log_id',v_log,'reference_id',v_ref,
    'event_key',e.event_key,'related_type',e.related_type,'related_id',e.related_id,
    'recipient',v_recipient,'template_key',t.template_key,'from_account',v_sender,
    'subject',t.subject,'text_body',t.text_body,'html',t.html,'vars',v_vars
  );
end
$$;
