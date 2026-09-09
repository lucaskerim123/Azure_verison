-- Keep public.customers aligned with profile/enforcement state and use canonical customer email for mail.
create or replace function public.sync_customer_from_profile()
returns trigger language plpgsql security definer set search_path='public' as $$
begin
 update public.customers
 set name=coalesce(nullif(new.display_name,''),nullif(trim(concat_ws(' ',new.first_name,new.last_name)),''),name),
     status=case when new.banned_at is not null and (new.ban_expires_at is null or new.ban_expires_at>now()) then 'banned' else coalesce(new.status,'active') end,
     email_verified_at=coalesce(new.email_verified_at,email_verified_at),
     updated_at=now()
 where auth_user_id=new.id;
 return new;
end $$;

drop trigger if exists user_profiles_sync_customer on public.user_profiles;
create trigger user_profiles_sync_customer
after insert or update of display_name,first_name,last_name,status,banned_at,ban_expires_at,email_verified_at
on public.user_profiles
for each row execute function public.sync_customer_from_profile();

update public.customers c
set name=coalesce(nullif(p.display_name,''),nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),c.name),
    status=case when p.banned_at is not null and (p.ban_expires_at is null or p.ban_expires_at>now()) then 'banned' else p.status end,
    email_verified_at=coalesce(c.email_verified_at,p.email_verified_at),
    updated_at=now()
from public.user_profiles p
where p.id=c.auth_user_id;

create or replace function public.admin_customer_mail_snapshot(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_email text; v_templates jsonb; v_logs jsonb;
begin
 if not public.has_permission('customers.view') then raise exception 'permission denied: customers.view'; end if;
 select email into v_email from public.customers where auth_user_id=p_user_id;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.category,t.name),'[]'::jsonb) into v_templates
 from public.mail_templates t where t.enabled=true;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_logs
 from (
   select id,provider_id,template_key,event_type,related_type,related_id,recipient,sender,subject,status,error,sent_at,created_at
   from public.mail_delivery_log
   where lower(recipient)=lower(coalesce(v_email,''))
   order by created_at desc limit 100
 ) x;
 return jsonb_build_object('email',v_email,'templates',v_templates,'logs',v_logs);
end $$;
