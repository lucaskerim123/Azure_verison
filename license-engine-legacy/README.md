# OrbitFS Licence Worker — recovered copy

Recovered from the currently deployed Cloudflare Worker `orbitfs-license-web`.

## Contents
- `src/index.js` — actual deployed Worker bundle recovered from Cloudflare.
- `wrangler.toml` — reconstructed runtime config and D1 binding.
- `cloudflare/settings.json` — live Worker settings response.
- `cloudflare/latest-version.json` — deployed version metadata.
- `cloudflare/worker.bundle` — untouched multipart download from Cloudflare.

## Secrets required for redeploy
Cloudflare reports these secret bindings; their values are intentionally not exported:
- `ADMIN_API_TOKEN`
- `ADMIN_SESSION_SECRET`
- `BILLING_API_TOKEN`
- `ENTITLEMENT_PRIVATE_KEY_B64`

The deployed source also references `KEY_ESCROW_SECRET` as an optional/fallback secret; verify whether it exists separately before redeploying.

## D1
Binding: `DB`
Database ID: `241ea4a6-5dff-40f2-8ada-05e7d13221af`

This recovery does not overwrite or redeploy the live Worker.
