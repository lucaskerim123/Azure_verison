import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed, getPanelLicenseSummary } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { STORAGE_BUCKET } from '$lib/server/base-compat';

export async function GET({ cookies, url }) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();

		const supabase = getSupabaseAdmin();
		const checkedAt = new Date().toISOString();
		const [workspaceHealth, fileHealth, bucketHealth, licence] = await Promise.all([
			supabase.from('orbitfs_workspaces').select('id', { count: 'exact', head: true }),
			supabase.from('orbitfs_files').select('id', { count: 'exact', head: true }).is('deleted_at', null),
			supabase.storage.getBucket(STORAGE_BUCKET),
			getPanelLicenseSummary()
		]);

		if (workspaceHealth.error) throw workspaceHealth.error;
		if (fileHealth.error) throw fileHealth.error;

		const database = {
			label: 'Supabase Database',
			role: 'OrbitFS metadata, users, workspaces and library state',
			status: 'Online',
			state: 'running',
			running: true,
			reachable: true,
			operational: true,
			managedBy: 'Supabase',
			workspaces: workspaceHealth.count ?? 0,
			files: fileHealth.count ?? 0,
			health: { ok: true, status: 200, message: 'Database query completed', checkedAt }
		};

		const storageOk = !bucketHealth.error && Boolean(bucketHealth.data);
		const storage = {
			label: 'Supabase Storage',
			role: 'Binary and large-file backing store',
			status: storageOk ? 'Online' : 'Degraded',
			state: storageOk ? 'running' : 'degraded',
			running: storageOk,
			reachable: storageOk,
			operational: storageOk,
			managedBy: 'Supabase',
			bucket: STORAGE_BUCKET,
			health: {
				ok: storageOk,
				status: storageOk ? 200 : 503,
				message: storageOk ? `Storage bucket ${STORAGE_BUCKET} is available` : String(bucketHealth.error?.message || 'Storage bucket is unavailable'),
				checkedAt
			}
		};

		const panel = {
			label: 'OrbitFS Panel',
			role: 'Main Vercel application and API',
			status: 'Online',
			state: 'running',
			running: true,
			reachable: true,
			operational: true,
			managedBy: 'Vercel',
			url: url.origin,
			apiBase: '/api',
			health: { ok: true, status: 200, message: 'Panel request completed', checkedAt }
		};

		const edge = {
			label: 'Vercel Edge',
			role: 'Public HTTPS routing and deployment edge',
			status: 'Online',
			state: 'running',
			running: true,
			reachable: true,
			operational: true,
			managedBy: 'Vercel',
			url: url.origin,
			health: { ok: true, status: 200, message: 'Request reached the active Vercel deployment', checkedAt }
		};

		const licenceStatus = {
			label: 'Licence Authority',
			role: 'OrbitFS installation and component entitlement',
			status: licence.licensed ? 'Online' : 'Blocked',
			state: licence.licensed ? 'running' : 'blocked',
			running: Boolean(licence.licensed),
			reachable: true,
			operational: Boolean(licence.licensed),
			managedBy: 'OrbitFS Licensing',
			licensed: Boolean(licence.licensed),
			blocked: !licence.licensed,
			health: { ok: Boolean(licence.licensed), status: licence.licensed ? 200 : 403, message: licence.licensed ? 'Panel licence is valid' : 'Panel licence is not currently valid', checkedAt }
		};

		return json({
			checkedAt,
			mode: 'cloud',
			filesystem: false,
			storageModel: 'supabase-library',
			panel,
			database,
			storage,
			edge,
			licence: licenceStatus,
			note: 'This Vercel edition is library/storage-backed. It does not depend on Windows services, local drive paths, resident processes or a persistent VPS filesystem.'
		});
	} catch (error: any) {
		return json({ error: String(error?.message || 'Failed to load system status') }, { status: Number(error?.status || 500) });
	}
}
