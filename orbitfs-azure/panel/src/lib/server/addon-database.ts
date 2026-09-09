import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';

export const SHARED_ADDON_DATABASE = {
	mode: 'shared-panel',
	provider: 'supabase',
	owner: 'panel',
	isolated: false
} as const;

export function sharedPanelDatabaseIdentity() {
	const url = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
	if (!url) throw Object.assign(new Error('SUPABASE_URL is required for the shared OrbitFS database.'), { status: 409, code: 'SHARED_DATABASE_REQUIRED' });
	return { ...SHARED_ADDON_DATABASE, url };
}

export async function assertSharedPanelDatabase(manifest: any = {}) {
	const requested = manifest?.database?.mode || manifest?.databaseMode || 'shared-panel';
	if (requested !== 'shared-panel') {
		throw Object.assign(new Error('OrbitFS add-ons must use the existing Panel Supabase database.'), { status: 409, code: 'ADDON_DATABASE_ISOLATION_NOT_ALLOWED' });
	}
	const identity = sharedPanelDatabaseIdentity();
	const db = getSupabaseAdmin();
	const check = await db.from('orbitfs_settings').select('key').limit(1);
	if (check.error) {
		throw Object.assign(new Error(`The existing Panel database is not ready for add-ons: ${check.error.message}`), { status: 409, code: 'PANEL_DATABASE_NOT_READY' });
	}
	return identity;
}
