-- OrbitFS guest support access codes.
-- Guest/basic support is limited to General Support and Sales.
-- New codes start at six characters, displayed as XX-XX-XX. The application parser
-- accepts longer codes too so the code length can be expanded later without a schema change.
-- Codes themselves are never stored in plaintext.

-- Keep the public department policy aligned with the guest support surface.
drop policy if exists guest_read_support_departments on public.support_departments;
create policy guest_read_support_departments on public.support_departments
for select to anon
using (enabled=true and name in ('General Support','Sales Enquiries','Sales'));

-- Failed guest-code attempts are tracked server-side because the compact code is a bearer key.
create table if not exists public.guest_support_access_attempts (
  id bigserial primary key,
  request_ip text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists guest_support_access_attempts_ip_time_idx
  on public.guest_support_access_attempts(request_ip,attempted_at desc);
alter table public.guest_support_access_attempts enable row level security;
revoke all on public.guest_support_access_attempts from anon, authenticated;

-- Never allow two guest tickets to carry the same active hash.
create unique index if not exists support_tickets_guest_access_hash_unique
  on public.support_tickets ((metadata->>'guest_access_hash'))
  where source='public_web' and metadata ? 'guest_access_hash';

-- The creation email carries the private ticket code and expiry information.
update public.mail_templates
set subject='OrbitFS guest support ticket #{{ticket_number}}',
    html='<p>Hello {{customer_name}},</p><p>We received your support request <strong>#{{ticket_number}}</strong>: {{ticket_subject}}</p><p>Your private guest ticket code is:</p><p style="font-size:20px;font-weight:700;letter-spacing:1px">{{guest_code}}</p><p>Use this code on the OrbitFS Support page to read replies and continue the conversation without an account.</p><p>This guest ticket expires and is automatically deleted at <strong>{{expires_at}}</strong>.</p><p>Guest support is limited to General Support and Sales.</p>',
    text_body='Hello {{customer_name}},\n\nWe received your support request #{{ticket_number}}: {{ticket_subject}}.\n\nYour private guest ticket code is: {{guest_code}}\n\nUse this code on the OrbitFS Support page to read replies and continue the conversation without an account.\n\nThis guest ticket expires and is automatically deleted at {{expires_at}}.\n\nGuest support is limited to General Support and Sales.',
    updated_at=now()
where template_key='support_guest_created';

update public.mail_automations
set variables='["customer_name","ticket_number","ticket_subject","guest_email","guest_code","expires_at"]'::jsonb,
    description='Confirm a temporary guest support request and provide its private 48-hour access code',
    updated_at=now()
where event_key='support.guest.created';

create or replace function public.process_expired_guest_support_tickets()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare deleted_count integer:=0; attempt_count integer:=0;
begin
  with expired as (
    select t.id
    from public.support_tickets t
    where t.user_id is null
      and t.source='public_web'
      and coalesce(
        nullif(t.metadata->>'guest_access_expires_at','')::timestamptz,
        t.created_at + interval '48 hours'
      ) <= now()
    for update skip locked
  ), removed as (
    delete from public.support_tickets t
    using expired e
    where t.id=e.id
    returning t.id
  )
  select count(*) into deleted_count from removed;

  with removed_attempts as (
    delete from public.guest_support_access_attempts
    where attempted_at < now() - interval '24 hours'
    returning id
  )
  select count(*) into attempt_count from removed_attempts;

  return jsonb_build_object(
    'ok',true,
    'deleted_count',deleted_count,
    'access_attempts_cleaned',attempt_count,
    'processed_at',now()
  );
end
$$;

-- Reuse the existing pg_cron support infrastructure. Every 15 minutes keeps the
-- two-day expiry tight without relying on page visits or application traffic.
do $$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='orbitfs-guest-support-expiry' limit 1;
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule(
    'orbitfs-guest-support-expiry',
    '*/15 * * * *',
    'select public.process_expired_guest_support_tickets()'
  );
end $$;
