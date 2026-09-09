create or replace function public.run_billing_enforcement_scan()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  suspended_count integer := 0;
  restored_count integer := 0;
  native_changed integer := 0;
  auto_suspend boolean := true;
  grace_days integer := 0;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;

  select coalesce((value #>> '{}')::boolean,true)
    into auto_suspend
  from public.app_settings
  where key='license.auto_suspend_on_overdue_invoice'
  limit 1;

  select greatest(0,coalesce((value #>> '{}')::integer,0))
    into grace_days
  from public.app_settings
  where key='invoice.suspend_after_days'
  limit 1;

  if coalesce(auto_suspend,true) then
    update public.license_bindings b
       set desired_state='suspended',
           remote_state=case when b.api_source='website' then 'suspended' else b.remote_state end,
           suspension_reason='invoice overdue',
           updated_at=now()
     where b.desired_state='active'
       and b.archived_at is null
       and exists (
         select 1
           from public.invoices i
          where i.status in ('unpaid','partial','overdue')
            and i.due_at is not null
            and i.due_at + make_interval(days => grace_days) < now()
            and (
              (b.order_item_id is not null and exists (
                select 1 from public.order_items oi
                 where oi.id=b.order_item_id and oi.order_id=i.order_id
              ))
              or
              (b.order_item_id is null and i.auth_user_id=b.auth_user_id and exists (
                select 1 from public.order_items oi
                 where oi.order_id=i.order_id
                   and oi.license_product_key is not null
                   and (b.license_product_key is null or oi.license_product_key=b.license_product_key)
              ))
            )
       );
    get diagnostics suspended_count=row_count;

    insert into public.license_enforcement_queue(binding_id,auth_user_id,license_id,action,reason,source)
    select b.id,b.auth_user_id,b.license_id,'block','invoice overdue','billing_scan'
      from public.license_bindings b
     where b.api_source<>'website'
       and b.desired_state='suspended'
       and b.suspension_reason='invoice overdue'
       and not exists (
         select 1 from public.license_enforcement_queue q
          where q.binding_id=b.id and q.action='block' and q.state in ('queued','running')
       );
  end if;

  update public.license_bindings b
     set desired_state='active',
         remote_state=case when b.api_source='website' then 'active' else b.remote_state end,
         suspension_reason=null,
         updated_at=now()
   where b.desired_state='suspended'
     and b.suspension_reason='invoice overdue'
     and (
       not coalesce(auto_suspend,true)
       or not exists (
         select 1
           from public.invoices i
          where i.status in ('unpaid','partial','overdue')
            and i.due_at is not null
            and i.due_at + make_interval(days => grace_days) < now()
            and (
              (b.order_item_id is not null and exists (
                select 1 from public.order_items oi
                 where oi.id=b.order_item_id and oi.order_id=i.order_id
              ))
              or
              (b.order_item_id is null and i.auth_user_id=b.auth_user_id and exists (
                select 1 from public.order_items oi
                 where oi.order_id=i.order_id
                   and oi.license_product_key is not null
                   and (b.license_product_key is null or oi.license_product_key=b.license_product_key)
              ))
            )
       )
     )
     and exists (
       select 1 from public.user_profiles p
        where p.id=b.auth_user_id and p.status='active' and p.banned_at is null
     );
  get diagnostics restored_count=row_count;

  insert into public.license_enforcement_queue(binding_id,auth_user_id,license_id,action,reason,source)
  select b.id,b.auth_user_id,b.license_id,'unblock','billing restored','billing_scan'
    from public.license_bindings b
   where b.api_source<>'website'
     and b.desired_state='active'
     and b.suspension_reason is null
     and b.updated_at>now()-interval '1 minute'
     and not exists (
       select 1 from public.license_enforcement_queue q
        where q.binding_id=b.id and q.action='unblock' and q.state in ('queued','running')
     );

  select count(*) into native_changed
    from public.license_bindings
   where api_source='website' and updated_at>now()-interval '1 minute';
  if native_changed>0 then perform public.bump_license_revision(); end if;

  return jsonb_build_object(
    'suspended',suspended_count,
    'restored',restored_count,
    'native_changed',native_changed,
    'auto_suspend',coalesce(auto_suspend,true),
    'grace_days',grace_days
  );
end
$$;
