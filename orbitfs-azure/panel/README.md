# OrbitFS V1 Vercel Base

`V1-vercel-base` is the main OrbitFS Panel/control plane for the Vercel + Supabase build.

## Base owns

- User authentication, registration and permissions
- Workspaces and workspace membership
- Library, Knowledge and Profiles
- Projects, OSS and CCS
- Panel-side Studio data/UI
- Licensing and installation identity
- Add-on install, attach, detach and entitlement state
- The shared Supabase-backed file/library model
- Release/update coordination and pre-update checkpoints

MCP, APEX and Studio runtime setup/monitoring belong to `V1-vercel-engine`. They are not linked during first-time Base setup. Keeping the Engine Host separate means a clean Base install never needs an Engine deployment, while installed engine-backed add-ons can still be updated by redeploying the existing Engine project later.

## First-time setup

1. Deploy the Panel to Vercel.
2. Configure the required server environment from `.env.example`.
3. Apply the OrbitFS Base database schema to the shared Supabase project.
4. Activate the OrbitFS Base System licence.
5. Open `/setup` and run **Prepare Base**. This verifies required tables and creates the private `orbitfs-files` bucket when needed.
6. Create the first Owner. OrbitFS creates or repairs the main `Public Workspace`, Owner membership and protected core folders.
7. Sign in normally.
8. Install MCP, APEX or Studio later from Add-on management. Panel validates entitlement/install state, attaches the engine to the shared Engine Host and then Engine first-time setup continues on `V1-vercel-engine`.

## Release model

OrbitFS uses two release branches.

### `BASE_RELEASE`

`BASE_RELEASE` is the current stable Base/Panel package for brand-new installations. It is always **core only**. Add-ons and the Shared Engine Host are handled after first install.

Typical stable Base versions can be `1.0.0`, `2.0.0`, `3.0.0`, or any version chosen as the current clean install baseline.

### `UPDATE_RELEASE`

`UPDATE_RELEASE` is for existing installations. Update versions can advance independently between Base milestones, for example `1.2.0`, `1.5.0`, `2.5.0` and so on.

The GitHub Action uses checkbox selectors for:

- Panel / Base (`core`)
- APEX
- MCP
- Studio

Selecting APEX, MCP or Studio automatically marks the release as requiring an Engine Host update. Panel-only updates do not require an Engine candidate.

Every `UPDATE_RELEASE` package requires an `orbitfs-update-checkpoint-v1` checkpoint before application. The checkpoint stores the current Panel deployment anchor, Engine Host release/link state, installed add-on state, safe global settings and active release metadata. It does not copy customer files and excludes Vercel credentials and secret-like settings. OrbitFS keeps the latest 20 checkpoints in Supabase for rollback/history.

## APEX install lifecycle

APEX is a real engine add-on, not a placeholder. The Panel owns install/licensing/attach controls and the Engine Host owns setup, readiness, processing and job execution. APEX processing does not become operational until the add-on is installed, attached, linked, configured and available. Its current implementation supports canonical Library/Knowledge processing, source-format validation, normalized document extraction, provenance, revisions, job control and routing targets.

## Required environment

The hard requirements are:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `ORBITFS_DB_SECRET`

Canonical service URL overrides and optional licence tuning are documented in `.env.example`.

## Setup readiness

The Base setup service checks these core tables before allowing Owner creation:

- `orbitfs_users`
- `orbitfs_workspaces`
- `orbitfs_workspace_members`
- `orbitfs_files`
- `orbitfs_settings`
- `orbitfs_license`
- `orbitfs_addons`
- `orbitfs_audit_log`

It also checks the `orbitfs-files` Supabase Storage bucket, Base System licence, active Owner and main workspace. Setup is only considered complete when all Base requirements are actually ready.

## Database note

`supabase/phase1.sql` is a legacy Phase 1 helper and is not a complete fresh-install schema. The currently deployed OrbitFS Supabase project remains the authoritative schema until a full reproducible migration/snapshot set is maintained in this repository.

## Development

```bash
npm install
npm run check
npm run build
```
