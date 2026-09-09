-- OrbitFS Store customer credentials are owned by the Store, not Supabase Auth.

create table if not exists public.customer_credentials (
  user_id uuid primary key,
  password_hash text not null,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_credentials_customer_identity_fkey
    foreign key (user_id) references public.customers(auth_user_id) on delete cascade
);

create table if not exists public.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.customer_credentials(user_id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip_address inet,
  user_agent text
);

create index if not exists customer_sessions_user_id_idx on public.customer_sessions(user_id);
create index if not exists customer_sessions_expires_at_idx on public.customer_sessions(expires_at) where revoked_at is null;

alter table public.customer_credentials enable row level security;
alter table public.customer_sessions enable row level security;
revoke all on table public.customer_credentials from anon, authenticated;
revoke all on table public.customer_sessions from anon, authenticated;

alter table public.password_reset_tokens drop constraint if exists password_reset_tokens_user_id_fkey;
delete from public.password_reset_tokens p
where not exists (select 1 from public.customers c where c.auth_user_id=p.user_id);
alter table public.password_reset_tokens
  add constraint password_reset_tokens_customer_identity_fkey
  foreign key (user_id) references public.customers(auth_user_id) on delete cascade;

alter table public.email_verification_tokens drop constraint if exists email_verification_tokens_user_id_fkey;
delete from public.email_verification_tokens e
where not exists (select 1 from public.customers c where c.auth_user_id=e.user_id);
alter table public.email_verification_tokens
  add constraint email_verification_tokens_customer_identity_fkey
  foreign key (user_id) references public.customers(auth_user_id) on delete cascade;

comment on table public.customer_credentials is 'OrbitFS Store-owned customer password credentials. Not Supabase Auth users.';
comment on table public.customer_sessions is 'OrbitFS Store-owned customer login sessions. Not Supabase Auth sessions.';
