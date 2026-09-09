-- OrbitFS Website
-- Support invoice-only billing records in admin state management.
-- Linked invoices continue to use the existing order-based billing state workflow.

create or replace function public.admin_set_invoice_billing_state(
  p_invoice_id uuid,
  p_state text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  inv public.invoices%rowtype;
  rem bigint;
  old_state text;
begin
  if p_state not in ('unpaid','overdue','paid','apaid','suspended','cancelled') then
    raise exception 'invalid billing state';
  end if;

  select * into inv
  from public.invoices
  where id=p_invoice_id
  for update;

  if not found then
    raise exception 'invoice not found';
  end if;

  -- Orders remain the authority when the invoice belongs to one.
  if inv.order_id is not null then
    return public.admin_set_billing_state(inv.order_id,p_state,p_reason);
  end if;

  -- Standalone invoices are intentional records created with invoice_only mode.
  if not public.has_permission('invoices.edit') and not public.has_permission('orders.edit') then
    raise exception 'permission denied: invoices.edit';
  end if;

  old_state:=case
    when inv.status in ('cancelled','void') then 'cancelled'
    when inv.status='paid' then 'paid'
    when inv.status='overdue' then 'overdue'
    else 'unpaid'
  end;

  if old_state in ('paid','cancelled') and p_state<>old_state
     and not public.has_permission('billing.override_state') then
    raise exception 'permission denied: billing.override_state';
  end if;

  if p_state='unpaid' then
    update public.invoices
    set status='unpaid',paid_cents=0,paid_at=null,updated_at=now()
    where id=inv.id;

  elsif p_state='overdue' then
    update public.invoices
    set status='overdue',updated_at=now()
    where id=inv.id;

  elsif p_state='paid' then
    if coalesce(inv.paid_cents,0)<coalesce(inv.total_cents,0) then
      raise exception 'invoice is not fully paid; record payment or use APAID override';
    end if;
    update public.invoices
    set status='paid',paid_at=coalesce(paid_at,now()),updated_at=now()
    where id=inv.id;

  elsif p_state='apaid' then
    if not public.has_permission('orders.override_payment') then
      raise exception 'permission denied: orders.override_payment';
    end if;
    if nullif(trim(coalesce(p_reason,'')),'') is null then
      raise exception 'APAID override reason is required';
    end if;
    rem:=greatest(coalesce(inv.total_cents,0)-coalesce(inv.paid_cents,0),0);
    if rem>0 then
      insert into public.invoice_payments(
        invoice_id,auth_user_id,method,amount_cents,status,external_reference,metadata
      ) values(
        inv.id,inv.auth_user_id,'admin_override',rem,'completed','ADMIN-OVERRIDE',
        jsonb_build_object('reason',p_reason,'actor',auth.uid(),'state_override',true,'standalone_invoice',true)
      );
    end if;
    update public.invoices
    set status='paid',paid_cents=total_cents,paid_at=coalesce(paid_at,now()),updated_at=now()
    where id=inv.id;

  elsif p_state='suspended' then
    raise exception 'standalone invoices cannot be suspended because they have no linked order';

  elsif p_state='cancelled' then
    if not public.has_permission('invoices.void') and not public.has_permission('billing.override_state') then
      raise exception 'permission denied: invoices.void';
    end if;
    update public.invoices
    set status='cancelled',updated_at=now()
    where id=inv.id;
  end if;

  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(
    auth.uid(),'billing.state_override','invoice',inv.id::text,
    jsonb_build_object('from',old_state,'to',p_state,'reason',p_reason,'standalone',true)
  );

  return jsonb_build_object('ok',true,'state',p_state,'invoice_id',inv.id,'standalone',true);
end
$$;

revoke all on function public.admin_set_invoice_billing_state(uuid,text,text) from anon;
grant execute on function public.admin_set_invoice_billing_state(uuid,text,text) to authenticated;
