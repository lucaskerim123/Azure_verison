-- OrbitFS-owned customer email verification and canonical customer account fields.
alter table public.customers
  add column if not exists username text,
  add column if not exists email_verified_at timestamptz;

update public.customers c
set email_verified_at=coalesce(c.email_verified_at,p.email_verified_at,now())
from public.user_profiles p
where p.id=c.auth_user_id and c.email_verified_at is null;

create unique index if not exists customers_email_lower_uidx on public.customers(lower(email));
create unique index if not exists customers_username_lower_uidx on public.customers(lower(username)) where username is not null;

create table if not exists public.email_verification_tokens(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  request_ip inet,
  created_at timestamptz not null default now()
);
create index if not exists email_verification_tokens_user_idx on public.email_verification_tokens(user_id,created_at desc);
alter table public.email_verification_tokens enable row level security;

insert into public.mail_templates(template_key,name,category,subject,html,text_body,from_account,enabled)
values('account_email_verification','Verify email address','Account','Verify your OrbitFS email address',
'<p>Hi {{customer_name}},</p><p>Verify your email address to finish setting up your OrbitFS account.</p><p><a href="{{verification_url}}">Verify email address</a></p><p>This link expires in {{expires_minutes}} minutes.</p>',
E'Hi {{customer_name}},\n\nVerify your email address to finish setting up your OrbitFS account:\n{{verification_url}}\n\nThis link expires in {{expires_minutes}} minutes.',
'noreply@orbitfs.cc',true)
on conflict(template_key) do update set
 name=excluded.name,category=excluded.category,subject=excluded.subject,html=excluded.html,text_body=excluded.text_body,
 from_account=excluded.from_account,enabled=true,updated_at=now();

insert into public.mail_automations(event_key,name,category,description,template_key,enabled,variables)
values('account.email_verification','Account email verification','Account',
'Sent by OrbitFS when a customer needs to verify their registered email address.',
'account_email_verification',true,'["customer_name","verification_url","expires_minutes"]'::jsonb)
on conflict(event_key) do update set
 name=excluded.name,category=excluded.category,description=excluded.description,template_key=excluded.template_key,
 enabled=true,variables=excluded.variables,updated_at=now();

create or replace function public.admin_get_customer_email(p_user_id uuid)
returns text language plpgsql stable security definer set search_path='public' as $$
declare e text;
begin
 if not public.has_permission('customers.password_reset') then raise exception 'permission denied: customers.password_reset'; end if;
 select email into e from public.customers where auth_user_id=p_user_id;
 return e;
end $$;
