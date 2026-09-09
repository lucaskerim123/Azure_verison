import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { ensureCoreFolders, STORAGE_BUCKET } from '$lib/server/base-compat';
import { ensureCloudAddonRecord } from '$lib/server/cloud-addons';
import { getPanelLicenseSummary } from '$lib/server/license';

export type SetupStep = 'core' | 'license' | 'owner' | 'workspace' | 'complete';

const REQUIRED_TABLES = [
	'orbitfs_users',
	'orbitfs_workspaces',
	'orbitfs_workspace_members',
	'orbitfs_files',
	'orbitfs_settings',
	'orbitfs_license',
	'orbitfs_addons',
	'orbitfs_audit_log'
] as const;

function configured(value: unknown) {
	return Boolean(String(value ?? '').trim());
}

async function tableReady(name: string) {
	try {
		const db = getSupabaseAdmin();
		const { error } = await db.from(name).select('*', { count: 'exact', head: true });
		return { ok: !error, detail: error?.message || 'Available' };
	} catch (error) {
		return { ok: false, detail: error instanceof Error ? error.message : 'Unavailable' };
	}
}

export async function getBaseSetupState() {
	const envReady = configured(env.SUPABASE_URL) && configured(env.SUPABASE_PUBLISHABLE_KEY) && configured(env.ORBITFS_DB_SECRET);
	const tableChecks = envReady ? await Promise.all(REQUIRED_TABLES.map(async (name) => [name, await tableReady(name)] as const)) : [];
	const tables = Object.fromEntries(tableChecks) as Record<string, { ok: boolean; detail: string }>;
	const schemaReady = envReady && REQUIRED_TABLES.every((name) => tables[name]?.ok === true);

	let storageReady = false;
	let storageDetail = envReady ? 'Storage bucket unavailable' : 'Supabase environment is incomplete';
	let licenseReady = false;
	let licenseDetail = 'Base System licence has not been activated';
	let licenseReason: string | null = 'LICENSE_REQUIRED';
	let ownerExists = false;
	let ownerId: string | null = null;
	let mainWorkspaceId: string | null = null;

	if (envReady && schemaReady) {
		const db = getSupabaseAdmin();
		const [bucket, owner, workspace, license] = await Promise.all([
			db.storage.getBucket(STORAGE_BUCKET),
			db.from('orbitfs_users').select('id').eq('role', 'owner').eq('status', 'active').limit(1).maybeSingle(),
			db.from('orbitfs_workspaces').select('id').eq('is_main', true).neq('status', 'archived').limit(1).maybeSingle(),
			getPanelLicenseSummary().catch((error) => ({ licensed: false, reason: error instanceof Error ? error.message : 'LICENSE_CHECK_FAILED' }))
		]);
		storageReady = !bucket.error && Boolean(bucket.data);
		storageDetail = storageReady ? `${STORAGE_BUCKET} is available` : bucket.error?.message || `${STORAGE_BUCKET} is missing`;
		licenseReady = license.licensed === true;
		licenseReason = licenseReady ? null : String(license.reason || 'LICENSE_REQUIRED');
		licenseDetail = licenseReady ? 'OrbitFS Base System licence is active' : `Base System licence required (${licenseReason})`;
		if (!owner.error && owner.data?.id) {
			ownerExists = true;
			ownerId = String(owner.data.id);
		}
		if (!workspace.error && workspace.data?.id) mainWorkspaceId = String(workspace.data.id);
	}

	const coreReady = envReady && schemaReady && storageReady;
	const setupComplete = coreReady && licenseReady && ownerExists && Boolean(mainWorkspaceId);
	const currentStep: SetupStep = !coreReady ? 'core' : !licenseReady ? 'license' : !ownerExists ? 'owner' : !mainWorkspaceId ? 'workspace' : 'complete';

	return {
		setupComplete,
		needsSetup: !setupComplete,
		currentStep,
		coreReady,
		licenseReady,
		licenseReason,
		ownerExists,
		ownerId,
		mainWorkspaceId,
		checks: {
			environment: {
				ok: envReady,
				detail: envReady ? 'Supabase server environment is configured' : 'SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and ORBITFS_DB_SECRET are required'
			},
			database: {
				ok: schemaReady,
				detail: schemaReady ? 'Required OrbitFS Base tables are available' : 'OrbitFS Base database schema is incomplete',
				tables
			},
			storage: { ok: storageReady, detail: storageDetail },
			license: { ok: licenseReady, detail: licenseDetail, reason: licenseReason },
			owner: { ok: ownerExists, detail: ownerExists ? 'Active Owner exists' : 'First Owner has not been created' },
			workspace: { ok: Boolean(mainWorkspaceId), detail: mainWorkspaceId ? 'Main workspace is available' : 'Main workspace has not been initialized' }
		}
	};
}

export async function ensureStorageBucket() {
	const db = getSupabaseAdmin();
	const existing = await db.storage.getBucket(STORAGE_BUCKET);
	if (!existing.error && existing.data) return existing.data;
	const created = await db.storage.createBucket(STORAGE_BUCKET, { public: false });
	if (created.error && !String(created.error.message || '').toLowerCase().includes('already')) throw created.error;
	return created.data;
}

export async function ensureDefaultWorkspace(ownerId: string) {
	const db = getSupabaseAdmin();
	const existing = await db.from('orbitfs_workspaces').select('id').eq('slug', 'public-workspace').maybeSingle();
	if (existing.error) throw existing.error;
	let workspaceId = existing.data?.id ? String(existing.data.id) : '';
	if (workspaceId) {
		const update = await db.from('orbitfs_workspaces').update({
			name: 'Public Workspace',
			description: 'Default workspace available to panel users.',
			status: 'active',
			visibility: 'public',
			is_main: true,
			delete_protected: true,
			storage_quota_bytes: 5 * 1024 ** 3,
			created_by: ownerId
		}).eq('id', workspaceId);
		if (update.error) throw update.error;
	} else {
		const created = await db.from('orbitfs_workspaces').insert({
			name: 'Public Workspace',
			slug: 'public-workspace',
			description: 'Default workspace available to panel users.',
			status: 'active',
			visibility: 'public',
			is_main: true,
			delete_protected: true,
			storage_quota_bytes: 5 * 1024 ** 3,
			created_by: ownerId
		}).select('id').single();
		if (created.error || !created.data?.id) throw created.error ?? new Error('Could not create Public Workspace');
		workspaceId = String(created.data.id);
	}
	const member = await db.from('orbitfs_workspace_members').upsert({ workspace_id: workspaceId, user_id: ownerId, role: 'owner' }, { onConflict: 'workspace_id,user_id' });
	if (member.error) throw member.error;
	await ensureCoreFolders(workspaceId, ownerId);
	return workspaceId;
}

async function ensureFreshEngineRegistry() {
	await Promise.all(['mcp', 'apex', 'studio'].map((id) => ensureCloudAddonRecord(id)));
}

export async function bootstrapBaseSetup() {
	const before = await getBaseSetupState();
	if (!before.checks.environment.ok) throw Object.assign(new Error(before.checks.environment.detail), { status: 503 });
	if (!before.checks.database.ok) throw Object.assign(new Error('OrbitFS Base database schema is incomplete. Apply the Base schema before continuing.'), { status: 503 });
	await Promise.all([ensureStorageBucket(), ensureFreshEngineRegistry()]);
	if (before.ownerId) await ensureDefaultWorkspace(before.ownerId);
	return getBaseSetupState();
}
