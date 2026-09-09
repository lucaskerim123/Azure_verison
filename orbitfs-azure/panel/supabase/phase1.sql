create table if not exists public.orbitfs_phase1_state (
	id text primary key,
	state jsonb not null default '{}'::jsonb,
	updated_at timestamptz not null default now()
);

alter table public.orbitfs_phase1_state enable row level security;

comment on table public.orbitfs_phase1_state is 'OrbitFS Phase 1 Base Panel persistent state. Server-side service role only.';
