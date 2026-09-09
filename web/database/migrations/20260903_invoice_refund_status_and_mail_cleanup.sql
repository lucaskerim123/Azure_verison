-- OrbitFS Website
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.
-- Keeps invoice status aligned with successful refund records and cleans Mail template/history rendering.

create or replace function public.sync_invoice_refund_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path='public'
as $$
declare
  inv public.invoices%rowtype;
  successful_refunded bigint:=0;
  pending_refunded bigint:=0;
  next_status text;
begin
  select * into inv from public.invoices where id=p_invoice_id for update;
  if not found then return; end if;

  select
    coalesce(sum(amount_cents) filter (where status in ('completed','succeeded')),0),
    coalesce(sum(amount_cents) filter (where status in ('pending','processing')),0)
  into successful_refunded,pending_refunded
  from public.invoice_refunds
  where invoice_id=inv.id;

  next_status:=inv.status;
  if coalesce(inv.paid_cents,0)>0 and successful_refunded>=coalesce(inv.paid_cents,0) then
    next_status:='refunded';
  elsif inv.status='refunded' and successful_refunded<coalesce(inv.paid_cents,0) then
    next_status:=case
      when coalesce(inv.paid_cents,0)>=coalesce(inv.total_cents,0) and coalesce(inv.total_cents,0)>0 then 'paid'
      when coalesce(inv.paid_cents,0)>0 then 'partial'
      when inv.due_at is not null and inv.due_at<now() then 'overdue'
      else 'unpaid'
    end;
  end if;

  update public.invoices
  set status=next_status,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'refunded_cents',successful_refunded,
        'refund_pending_cents',pending_refunded,
        'fully_refunded',coalesce(inv.paid_cents,0)>0 and successful_refunded>=coalesce(inv.paid_cents,0),
        'refunded_at',case when coalesce(inv.paid_cents,0)>0 and successful_refunded>=coalesce(inv.paid_cents,0) then coalesce(metadata->'refunded_at',to_jsonb(now())) else 'null'::jsonb end
      ),
      updated_at=now()
  where id=inv.id;
end
$$;

create or replace function public.invoice_refund_status_trigger()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
begin
  perform public.sync_invoice_refund_status(coalesce(new.invoice_id,old.invoice_id));
  return coalesce(new,old);
end
$$;

drop trigger if exists trg_invoice_refund_status on public.invoice_refunds;
create trigger trg_invoice_refund_status
after insert or update of status,amount_cents or delete on public.invoice_refunds
for each row execute function public.invoice_refund_status_trigger();

do $$ declare r record; begin
  for r in select distinct invoice_id from public.invoice_refunds loop
    perform public.sync_invoice_refund_status(r.invoice_id);
  end loop;
end $$;

-- Refunded, void and cancelled invoices are closed records and cannot accept new payment.
create or replace function public.available_payment_gateways(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare uid uuid:=auth.uid(); inv public.invoices%rowtype; out jsonb; is_wallet boolean:=false;
begin
 if uid is null then raise exception 'authentication required'; end if;
 select * into inv from public.invoices where id=p_invoice_id and auth_user_id=uid; if not found then raise exception 'invoice not found'; end if;
 if inv.status in ('refunded','void','cancelled') then return '[]'::jsonb; end if;
 is_wallet:=coalesce((inv.metadata->>'wallet_recharge')::boolean,false);
 select coalesce(jsonb_agg(jsonb_build_object('code',g.code,'name',g.display_name,'description',g.description,'provider',g.provider,'supports_recurring',g.supports_recurring,'fee_fixed_cents',g.fee_fixed_cents,'fee_percent',g.fee_percent,'public_config',g.public_config,'instructions',case when g.provider='manual' then g.instructions else null end) order by g.sort_order,g.display_name),'[]'::jsonb) into out
 from public.payment_gateways g where g.enabled=true and inv.currency=any(g.currencies) and (not is_wallet or g.provider<>'account_credit');
 return out;
end
$$;

create or replace function public.start_invoice_payment(p_invoice_id uuid,p_gateway_code text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  uid uuid:=auth.uid();
  inv public.invoices%rowtype;
  g public.payment_gateways%rowtype;
  due bigint;
  att uuid;
  res jsonb;
  applied bigint;
  remaining bigint;
begin
  if uid is null then raise exception 'authentication required'; end if;
  select * into inv from public.invoices where id=p_invoice_id and auth_user_id=uid for update;
  if not found then raise exception 'invoice not found'; end if;
  if inv.status='paid' then return jsonb_build_object('status','succeeded','invoice_id',inv.id,'already_paid',true); end if;
  if inv.status in ('refunded','void','cancelled') then raise exception 'invoice is closed and cannot accept payment'; end if;

  due:=greatest(0,inv.total_cents-inv.paid_cents);
  if due<=0 then raise exception 'nothing due'; end if;

  select * into g from public.payment_gateways where code=p_gateway_code and enabled=true;
  if not found then raise exception 'payment method is unavailable'; end if;
  if not inv.currency=any(g.currencies) then raise exception 'payment method does not support %',inv.currency; end if;

  if g.provider='account_credit' then
    res:=public.apply_wallet_credit_to_invoice(inv.id,null);
    applied:=coalesce((res->>'applied_cents')::bigint,0);
    remaining:=coalesce((res->>'remaining_cents')::bigint,0);
    insert into public.payment_attempts(invoice_id,auth_user_id,gateway_id,gateway_code,amount_cents,currency,status,metadata,completed_at,updated_at)
    values(inv.id,uid,g.id,g.code,applied,inv.currency,'succeeded',jsonb_build_object('wallet_result',res,'partial_invoice_payment',remaining>0),now(),now()) returning id into att;
    if remaining>0 then
      return jsonb_build_object('attempt_id',att,'status','pending','invoice_id',inv.id,'order_id',inv.order_id,'applied_cents',applied,'remaining_cents',remaining,'wallet_balance_cents',coalesce((res->>'wallet_balance_cents')::bigint,0),'instructions',format('Wallet credit applied. %s cents remain to pay with another payment method.',remaining));
    end if;
    return jsonb_build_object('attempt_id',att,'status','succeeded','invoice_id',inv.id,'order_id',inv.order_id,'applied_cents',applied,'remaining_cents',0,'wallet_balance_cents',coalesce((res->>'wallet_balance_cents')::bigint,0));
  end if;

  insert into public.payment_attempts(invoice_id,auth_user_id,gateway_id,gateway_code,amount_cents,currency,status)
  values(inv.id,uid,g.id,g.code,due,inv.currency,case when g.provider='manual' then 'pending' else 'action_required' end) returning id into att;
  if g.provider='manual' then
    return jsonb_build_object('attempt_id',att,'status','pending','gateway',g.code,'instructions',g.instructions);
  elsif g.provider in ('stripe','paypal') then
    return jsonb_build_object('attempt_id',att,'status','action_required','gateway',g.code,'invoice_id',inv.id,'order_id',inv.order_id);
  else
    update public.payment_attempts set status='failed',failure_code='unsupported_gateway',failure_message='Unsupported payment gateway provider.',updated_at=now() where id=att;
    raise exception 'Unsupported gateway provider';
  end if;
end
$$;

-- Normalise legacy Mail templates that stored literal newline escape sequences.
update public.mail_templates
set text_body=replace(text_body,'\n',E'\n'),
    html=case when html is null then null else replace(html,'\n',E'\n') end,
    updated_at=now()
where coalesce(text_body,'') like '%\n%' or coalesce(html,'') like '%\n%';

-- Quick Send is for customer-safe/manual templates. Lifecycle templates requiring an
-- invoice/order/refund/ticket context stay available to the lifecycle automation system
-- instead of exposing unresolved {{variables}} in Customer > Emails.
create or replace function public.admin_customer_mail_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public','auth'
as $$
declare v_email text; v_templates jsonb; v_logs jsonb;
begin
  if not public.has_permission('customers.view') then raise exception 'permission denied: customers.view'; end if;
  select email into v_email from auth.users where id=p_user_id;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.category,t.name),'[]'::jsonb) into v_templates
  from public.mail_templates t
  where t.enabled=true
    and not exists (
      select 1
      from regexp_matches(coalesce(t.subject,'')||' '||coalesce(t.text_body,'')||' '||coalesce(t.html,''),'{{\s*([^}]+?)\s*}}','g') m
      where lower(trim(m[1])) not in ('customer_name','message','email_refrence_id','email_reference_id','staff_name','staff_email','staff_user_id')
    );

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_logs
  from (
    select id,provider_id,template_key,event_type,related_type,related_id,recipient,sender,subject,status,error,sent_at,created_at
    from public.mail_delivery_log
    where lower(recipient)=lower(coalesce(v_email,''))
    order by created_at desc limit 100
  ) x;
  return jsonb_build_object('email',v_email,'templates',v_templates,'logs',v_logs);
end
$$;

-- Finalisers accept the rendered subject so history shows actual invoice/order numbers,
-- not the raw {{template_variable}} subject stored before delivery rendering.
drop function if exists public.mail_outbox_finalize(uuid,uuid,uuid,text,text,text);
create function public.mail_outbox_finalize(p_id uuid,p_token uuid,p_log_id uuid,p_provider_id text,p_status text,p_error text,p_subject text default null)
returns boolean
language plpgsql
security definer
set search_path='public'
as $$
begin
  if not exists(select 1 from public.mail_event_outbox where id=p_id and dispatch_token=p_token) then raise exception 'invalid mail dispatch'; end if;
  update public.mail_delivery_log
  set provider_id=p_provider_id,status=p_status,error=p_error,
      subject=coalesce(nullif(p_subject,''),subject),
      sent_at=case when p_status='sent' then now() else null end
  where id=p_log_id;
  if not found then raise exception 'mail delivery record not found'; end if;
  update public.mail_event_outbox
  set state=case when p_status='sent' then 'sent' else 'failed' end,
      processed_at=case when p_status='sent' then now() else null end,
      last_error=p_error,
      next_attempt_at=case when p_status='sent' then next_attempt_at else now()+interval '5 minutes' end
  where id=p_id;
  return true;
end
$$;

drop function if exists public.mail_finalize_delivery(uuid,text,text,text,timestamptz);
create function public.mail_finalize_delivery(p_log_id uuid,p_provider_id text,p_status text,p_error text,p_sent_at timestamptz,p_subject text default null)
returns boolean
language plpgsql
security definer
set search_path='public'
as $$
begin
  if auth.role()='service_role' then
    update public.mail_delivery_log set provider_id=p_provider_id,status=p_status,error=p_error,sent_at=p_sent_at,subject=coalesce(nullif(p_subject,''),subject) where id=p_log_id;
  else
    if auth.uid() is null or not public.is_staff() then raise exception 'Mail access denied'; end if;
    update public.mail_delivery_log set provider_id=p_provider_id,status=p_status,error=p_error,sent_at=p_sent_at,subject=coalesce(nullif(p_subject,''),subject) where id=p_log_id and sent_by_user_id=auth.uid();
  end if;
  if not found then raise exception 'Mail delivery record not found'; end if;
  return true;
end
$$;
