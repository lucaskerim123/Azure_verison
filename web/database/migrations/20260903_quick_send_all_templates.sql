-- OrbitFS Website
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.
-- Quick Send exposes every enabled OrbitFS Mail template. Templates that require
-- contextual variables are completed by dynamic fields in the Admin customer UI.

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
  where t.enabled=true;

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
