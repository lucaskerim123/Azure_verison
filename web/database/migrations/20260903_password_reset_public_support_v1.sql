-- OrbitFS custom password reset + public support access.
create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  requested_by uuid references auth.users(id) on delete set null,
  request_ip inet,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_tokens_user_created_idx on public.password_reset_tokens(user_id,created_at desc);
create index if not exists password_reset_tokens_expiry_idx on public.password_reset_tokens(expires_at) where used_at is null;
alter table public.password_reset_tokens enable row level security;
revoke all on public.password_reset_tokens from anon, authenticated;

insert into public.mail_templates(template_key,name,category,subject,html,text_body,from_account,enabled)
values
('account_password_reset','Password reset','account','Reset your OrbitFS password','<p>Hello {{customer_name}},</p><p>A password reset was requested for your OrbitFS account.</p><p><a href="{{reset_url}}">Reset your password</a></p><p>This link expires in {{expires_minutes}} minutes and can only be used once.</p><p>If you did not request this, you can ignore this email.</p>','Hello {{customer_name}},\n\nA password reset was requested for your OrbitFS account.\n\nReset your password: {{reset_url}}\n\nThis link expires in {{expires_minutes}} minutes and can only be used once.\n\nIf you did not request this, you can ignore this email.','noreply@orbitfs.cc',true),
('support_guest_created','Guest support ticket created','support','OrbitFS support ticket #{{ticket_number}} received','<p>Hello {{customer_name}},</p><p>We received your support request <strong>#{{ticket_number}}</strong>: {{ticket_subject}}</p><p>Our team will reply to {{guest_email}}.</p>','Hello {{customer_name}},\n\nWe received your support request #{{ticket_number}}: {{ticket_subject}}.\n\nOur team will reply to {{guest_email}}.','noreply@orbitfs.cc',true)
on conflict (template_key) do update set name=excluded.name,category=excluded.category,subject=excluded.subject,html=excluded.html,text_body=excluded.text_body,from_account=excluded.from_account,enabled=excluded.enabled,updated_at=now();

insert into public.mail_automations(event_key,name,category,description,template_key,enabled,variables)
values
('account.password_reset','Password reset','account','Send OrbitFS password reset link','account_password_reset',true,'["customer_name","reset_url","expires_minutes"]'::jsonb),
('support.guest.created','Guest support confirmation','support','Confirm a public guest support request','support_guest_created',true,'["customer_name","ticket_number","ticket_subject","guest_email"]'::jsonb)
on conflict (event_key) do update set name=excluded.name,category=excluded.category,description=excluded.description,template_key=excluded.template_key,enabled=excluded.enabled,variables=excluded.variables,updated_at=now();

drop policy if exists guest_read_support_departments on public.support_departments;
create policy guest_read_support_departments on public.support_departments for select to anon using (enabled=true and name in ('General Support','Sales Enquiries'));

insert into public.mail_accounts(address,display_name,kind,active)
values ('noreply@orbitfs.cc','OrbitFS','shared',true)
on conflict (address) do update set display_name=excluded.display_name,kind=excluded.kind,active=true,updated_at=now();

create or replace function public.support_ticket_mail_context(p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','auth'
as $function$
declare t public.support_tickets%rowtype; v_email text; v_name text; v_department_email text; v_department_name text; v_guest boolean:=false;
begin
 select * into t from public.support_tickets where id=p_ticket_id; if not found then raise exception 'ticket not found'; end if;
 if t.user_id is not null and auth.uid()=t.user_id then null;
 else
  if not (public.has_permission('support.manage') or public.has_permission('support.reply') or public.has_permission('support.close')) then raise exception 'permission denied'; end if;
  if not public.support_staff_can_access_ticket(p_ticket_id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
 end if;
 if t.user_id is not null then
  select u.email,coalesce(nullif(p.display_name,''),nullif(concat_ws(' ',p.first_name,p.last_name),''),'Customer') into v_email,v_name from auth.users u left join public.user_profiles p on p.id=u.id where u.id=t.user_id;
 else
  v_email=nullif(trim(t.metadata->>'contact_email'),''); v_name=coalesce(nullif(trim(t.metadata->>'contact_name'),''),'Guest'); v_guest=true;
 end if;
 select d.email,d.name into v_department_email,v_department_name from public.support_departments d where d.id=t.department_id;
 return jsonb_build_object('email',v_email,'customer_name',v_name,'ticket_id',t.id,'ticket_number',t.ticket_number,'subject',t.subject,'status',t.status,'user_id',t.user_id,'department_id',t.department_id,'department_name',v_department_name,'department_email',v_department_email,'is_guest',v_guest);
end $function$;
