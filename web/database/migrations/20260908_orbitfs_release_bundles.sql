-- Unified customer-facing OrbitFS releases.
-- Panel and Engine packages remain immutable artifact records underneath a bundle.

create table if not exists public.orbitfs_release_bundles (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version ~ '^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$'),
  channel text not null check (channel in ('base','update')),
  status text not null default 'draft' check (status in ('draft','published','paused','superseded','withdrawn','failed')),
  title text not null default '',
  description text not null default '',
  changelog text not null default '',
  customer_notes text not null default '',
  internal_notes text not null default '',
  severity text not null default 'normal' check (severity in ('normal','important','critical')),
  required boolean not null default false,
  rollout text not null default 'public' check (rollout in ('internal','beta','public')),
  minimum_version text,
  rollback_version text,
  schema_version text not null default '1',
  checkpoint_required boolean not null default false,
  components jsonb not null default '[]'::jsonb check (jsonb_typeof(components)='array'),
  panel_artifact jsonb check (panel_artifact is null or jsonb_typeof(panel_artifact)='object'),
  engine_artifact jsonb check (engine_artifact is null or jsonb_typeof(engine_artifact)='object'),
  base_source_commit text,
  engine_source_commit text,
  engine_deployer_protocol integer not null default 1 check (engine_deployer_protocol >= 1),
  minimum_engine_deployer_protocol integer not null default 1 check (minimum_engine_deployer_protocol >= 1),
  technical_analysis jsonb not null default '{}'::jsonb check (jsonb_typeof(technical_analysis)='object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists orbitfs_release_bundles_channel_status_idx
  on public.orbitfs_release_bundles(channel,status,updated_at desc);
create index if not exists orbitfs_release_bundles_published_idx
  on public.orbitfs_release_bundles(published_at desc)
  where published_at is not null;

alter table public.orbitfs_release_bundles enable row level security;
drop policy if exists "staff release bundles read" on public.orbitfs_release_bundles;
create policy "staff release bundles read"
  on public.orbitfs_release_bundles for select to authenticated
  using (public.has_permission('licenses.view'));

-- Writes stay server-side through the Store service-role client. Customers never write release control state.
revoke insert, update, delete on public.orbitfs_release_bundles from anon, authenticated;
