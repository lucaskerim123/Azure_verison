-- Restricted accounts cannot begin or continue invoice payment flows.
create or replace function public.start_invoice_payment(p_invoice_id uuid, p_gateway_code text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
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
  if not public.account_can_order(uid) then raise exception 'account is restricted; contact support via ticket or support@orbitfs.cc'; end if;

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
$function$;
