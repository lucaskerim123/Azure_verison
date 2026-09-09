# OrbitFS Website — Master Architecture

## Purpose
OrbitFS Website is the commercial/control plane for OrbitFS. It owns storefront/catalog, customers, orders, payment state, licence fulfilment orchestration, admin operations and reporting.

## Components
- `web/` — Next.js storefront + customer account + MASTER Admin.
- `orbitfs-azure/` — Azure composition/deployment layer for the real OrbitFS runtime.
- `license-engine-legacy/` — recovered live Cloudflare Worker source, preserved as reference/runtime until migration.
- Supabase `OrbitFS Website` — commerce and control-plane database.
- Existing licence Worker — validation, activation locks, signed entitlements and enforcement API.

## Azure OrbitFS Core
The Azure runtime does **not** replace or fork the Base and Engine source. The authoritative runtime source remains:

- `lucaskerim123/V1-vercel-base` — OrbitFS Panel/Base.
- `lucaskerim123/V1-vercel-engine` — shared Engine Host for MCP/APEX/Studio.

`.github/workflows/orbitfs-core-azure.yml` checks out those private repositories at build time, converts their Vercel adapter to the SvelteKit Node adapter, builds them as Node applications, and deploys them to separate Azure App Service Web Apps. This preserves the existing Base/Engine separation while making the runtime Azure-native.

The Panel and Engine share the same customer OrbitFS Supabase project. The workflow automatically sets `ORBITFS_PANEL_URL` and `ORBITFS_ENGINE_HOST_URL`; database/licensing secrets remain Azure App Service settings and are not stored in this repository.

## Boundary
The browser never receives billing/admin secrets or licence service tokens. Store server routes call the licence engine through a server-only adapter. The Azure runtime remains separate from the commercial Store/control plane and uses the customer's OrbitFS data boundary.

## Core Admin Areas
Dashboard; Products & bundles; Orders; Customers; Licences; Devices/installations; Fulfilment queue; Enforcement; API/health; Audit log; Webhooks; Settings.
