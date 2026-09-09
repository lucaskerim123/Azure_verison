# OrbitFS Website — Master Architecture

## Purpose
OrbitFS Website is the commercial/control plane for OrbitFS. It owns storefront/catalog, customers, orders, payment state, licence fulfilment orchestration, admin operations and reporting.

## Components
- `web/` — Next.js storefront + customer account + MASTER Admin.
- `license-engine-legacy/` — recovered live Cloudflare Worker source, preserved as reference/runtime until migration.
- Supabase `OrbitFS Website` — commerce and control-plane database.
- Existing licence Worker — validation, activation locks, signed entitlements and enforcement API.

## Boundary
The browser never receives billing/admin secrets or licence service tokens. Vercel server routes call the licence engine through a server-only adapter. This lets the current Cloudflare worker stay live while the implementation can later move behind the same adapter.

## Core Admin Areas
Dashboard; Products & bundles; Orders; Customers; Licences; Devices/installations; Fulfilment queue; Enforcement; API/health; Audit log; Webhooks; Settings.
