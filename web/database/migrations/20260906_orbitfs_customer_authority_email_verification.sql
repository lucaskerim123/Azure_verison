-- OrbitFS customer authority + custom email verification.
alter table public.customers
  add column if not exists username text,
  add column if not exists display_name text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists company_name text,
  add column if not exists phone text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists state_region text,
  add column if not exists postal_code text,
  add column if not exists country_code text,
  add column if not exists timezone text,
  add column if not exists currency text,
  add column if not exists language text,
  add column if not exists email_verified_at timestamptz;

create unique index if not exists customers_auth_user_id_uidx on public.customers(auth_user_id) where auth_user_id is not null;
create unique index if not exists customers_email_lower_uidx on public.customers(lower(email));

create table if not exists public.email_verification_tokens(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 token_hash text not null unique,
 expires_at timestamptz not null,
 used_at timestamptz,
 created_at timestamptz not null default now(),
 request_ip inet
);
create index if not exists email_verification_tokens_user_idx on public.email_verification_tokens(user_id,created_at desc);

create or replace function public.sync_customer_from_profile()
returns trigger language plpgsql security definer set search_path='public' as $$
begin
 update public.customers
 set name=coalesce(nullif(new.display_name,''),nullif(trim(concat_ws(' ',new.first_name,new.last_name)),''),name),
     display_name=new.display_name,first_name=new.first_name,last_name=new.last_name,company_name=new.company_name,phone=new.phone,
     address_line1=new.address_line1,address_line2=new.address_line2,city=new.city,state_region=new.state_region,postal_code=new.postal_code,
     country_code=new.country_code,timezone=new.timezone,currency=new.currency,language=new.language,
     status=case when new.banned_at is not null and (new.ban_expires_at is null or new.ban_expires_at>now()) then 'banned' else coalesce(new.status,'active') end,
     customer_number=coalesce(new.customer_number,customer_number),
     email_verified_at=coalesce(new.email_verified_at,email_verified_at),
     updated_at=now()
 where auth_user_id=new.id;
 return new;
end $$;

insert into public.mail_templates(template_key,name,category,subject,html,text_body,from_account,enabled,created_at,updated_at)
values('account.email_verification','Verify OrbitFS email','account','Verify your OrbitFS email address',
'<p>Hi {{customer_name}},</p><p>Verify your email address to activate your OrbitFS account.</p><p><a href="{{verification_url}}">Verify email address</a></p><p>This link expires in {{expires_hours}} hours.</p><p>If you did not create this account, you can ignore this email.</p>',
'Hi {{customer_name}},\n\nVerify your email address to activate your OrbitFS account:\n{{verification_url}}\n\nThis link expires in {{expires_hours}} hours.\n\nIf you did not create this account, you can ignore this email.',
'noreply@orbitfs.cc',true,now(),now())
on conflict(template_key) do update set subject=excluded.subject,html=excluded.html,text_body=excluded.text_body,from_account=excluded.from_account,enabled=true,updated_at=now();

insert into public.mail_automations(event_key,name,category,description,template_key,enabled,variables,updated_at)
values('account.email_verification','Account email verification','account','Sent when an OrbitFS customer registers or requests a new verification link.','account.email_verification',true,'["customer_name","verification_url","expires_hours"]'::jsonb,now())
on conflict(event_key) do update set template_key=excluded.template_key,enabled=true,variables=excluded.variables,updated_at=now();
