import { json } from '@sveltejs/kit';
import { getPanelLicenseSummary } from '$lib/server/license';
import { STORAGE_BUCKET } from '$lib/server/base-compat';
import { bootstrapBaseSetup, getBaseSetupState } from '$lib/server/setup';
import { configuredEngineHostUrl } from '$lib/server/engine-host-state';

async function setupModel(origin = '') {
	const state = await getBaseSetupState();
	const engineHostUrl = configuredEngineHostUrl();
	return {
		...state,
		coreRequired: ['Vercel runtime', 'OrbitFS database schema', 'Supabase Storage', 'Base System licence'],
		config: {
			publicOrigin: origin,
			backendPort: 'managed by Vercel',
			apiBase: '/api',
			deployMode: 'vercel',
			storageRoot: `Supabase Storage / ${STORAGE_BUCKET}`,
			workspaceRoot: 'Supabase orbitfs_workspaces + orbitfs_files',
			systemRoot: 'Supabase orbitfs_* tables',
			engineHostUrl: engineHostUrl || '',
			mcpEndpoint: engineHostUrl ? `${engineHostUrl}/mcp` : '',
			licenseApiUrl: 'https://orbitfs.vercel.app/api/license/v1'
		},
		steps: {
			runtime: {
				title: 'Vercel runtime',
				description: state.checks.environment.detail,
				complete: state.checks.environment.ok
			},
			database: {
				title: 'OrbitFS database',
				description: state.checks.database.detail,
				complete: state.checks.database.ok
			},
			storage: {
				title: 'Supabase Storage',
				description: state.checks.storage.detail,
				complete: state.checks.storage.ok
			},
			license: {
				title: 'Base System licence',
				description: state.checks.license.detail,
				complete: state.checks.license.ok
			},
			owner: {
				title: 'First Owner',
				description: state.checks.owner.detail,
				complete: state.checks.owner.ok
			},
			workspace: {
				title: 'Main workspace',
				description: state.checks.workspace.detail,
				complete: state.checks.workspace.ok
			}
		},
		addons: [
			{ id: 'mcp', name: 'OrbitFS MCP', linked: false, firstSetup: false },
			{ id: 'apex', name: 'OrbitFS APEX', linked: false, firstSetup: false },
			{ id: 'studio', name: 'OrbitFS Studio', linked: false, firstSetup: false }
		],
		notes: [
			'OrbitFS Panel is the main control plane.',
			'First-time Base setup prepares the database, storage, licence, Owner account and main workspace only.',
			'Workspace files and Library paths are virtual records backed by Supabase, not folders on a persistent server drive.',
			'MCP, APEX and Studio are registered but not linked during Base setup. Install and attach them later from Add-on management.',
			...(engineHostUrl
				? [`Engine Host: ${engineHostUrl}`, `MCP endpoint: ${engineHostUrl}/mcp`]
				: ['No Engine Host is configured yet. This is expected during Base-only first-time setup.'])
		]
	};
}

function failure(error: any) {
	return json({ error: error?.message ?? 'Setup request failed' }, { status: Number(error?.status || 500) });
}

export async function GET({ params, url }) {
	try {
		if (String(params.rest || '') !== 'config') return json({ error: 'Not found' }, { status: 404 });
		return json(await setupModel(url.origin));
	} catch (error) { return failure(error); }
}

export async function PUT({ params, url }) {
	try {
		if (String(params.rest || '') !== 'config') return json({ error: 'Not found' }, { status: 404 });
		return json(await setupModel(url.origin));
	} catch (error) { return failure(error); }
}

export async function POST({ params, request, url }) {
	try {
		const rest = String(params.rest || '');
		if (rest === 'bootstrap') {
			await bootstrapBaseSetup();
			return json({ ok: true, ...(await setupModel(url.origin)) });
		}
		if (rest === 'test-link') {
			const body = await request.json().catch(() => ({}));
			const target = String(body.target ?? '');
			if (target === 'license') {
				const status = await getPanelLicenseSummary({ refresh: true });
				return json({ ok: true, message: status.licensed ? 'Licence service connected and Base System is licensed.' : `Licence service connected (${status.reason ?? 'not activated'}).` });
			}
			if (target === 'storage') {
				const state = await bootstrapBaseSetup();
				return json({ ok: state.checks.storage.ok, message: state.checks.storage.detail });
			}
			return json({ error: 'Unknown setup test target' }, { status: 400 });
		}
		return json({ error: 'Not found' }, { status: 404 });
	} catch (error) { return failure(error); }
}
