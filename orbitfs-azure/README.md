# OrbitFS Azure Core

This is the Azure composition layer for the OrbitFS runtime. The source of truth remains the private repositories `lucaskerim123/V1-vercel-base` and `lucaskerim123/V1-vercel-engine`; this repository builds those exact cores for Azure App Service rather than maintaining a second fork of the code.

## Runtime layout

- OrbitFS Panel/Base -> one Azure App Service Web App.
- OrbitFS Engine -> a separate Azure App Service Web App, deployed only when an engine-backed add-on is required.
- Both use the same customer OrbitFS Supabase project and installation state.
- The Vercel adapter is converted to the official SvelteKit Node adapter during the Azure build. SvelteKit's Node adapter produces a standalone Node server and uses Azure's `PORT` environment variable at runtime.

## GitHub secret required

Create `ORBITFS_SOURCE_TOKEN` in the `Azure_verison` repository. It must be a fine-grained token with read-only Contents access to:

- `lucaskerim123/V1-vercel-base`
- `lucaskerim123/V1-vercel-engine`

The workflow does not copy the private repositories into Git history. It checks them out during the build and deploys the resulting Node applications.

## Azure app settings required

Set these on the Panel app before first use:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `ORBITFS_DB_SECRET`
- `ORBITFS_ENTITLEMENT_PUBLIC_KEY` (if using a pinned entitlement key)
- `ORBITFS_LICENSE_REFRESH_MINUTES` (optional)
- `ORBITFS_LICENSE_TIMEOUT_MS` (optional)

Set these on the Engine app:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `ORBITFS_DB_SECRET`
- `ORBITFS_ENTITLEMENT_PUBLIC_KEY` (if used)

The workflow automatically sets `ORBITFS_PANEL_URL` and `ORBITFS_ENGINE_HOST_URL` to the Azure Web App URLs after deployment.

## Deploy

Run `.github/workflows/orbitfs-core-azure.yml` manually. Supply the actual Azure Web App names for Panel and Engine. Do not point the Panel input at the existing `OrbitFS-Website` storefront unless you intentionally want to replace that application; the current `OrbitFS-Website` workflow remains separate.

The existing Store/control-plane app remains in `web/`. This Azure core workflow does not replace or modify the Store deployment.
