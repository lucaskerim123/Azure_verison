import { json } from '@sveltejs/kit';
import { requireAdmin, requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';

const KEY = 'profiles.system.enabled';

async function current() {
	const supabase = getSupabaseAdmin();
	const { data, error } = await supabase.from('orbitfs_settings').select('value').eq('scope_type', 'global').eq('scope_id', '').eq('key', KEY).maybeSingle();
	if (error) throw error;
	return data?.value !== false;
}

export async function GET({ cookies }) {
	try {
		const user = await requireUser(cookies);
		await assertPanelLicensed();
		return json({ enabled: await current(), canManage: user.role === 'owner' || user.role === 'admin' });
	} catch (error: any) { return json({ error: error?.message || 'Request failed' }, { status: error?.status || 500 }); }
}

export async function PATCH({ cookies, request }) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();
		const body = await request.json().catch(() => ({}));
		const enabled = body.enabled !== false;
		const supabase = getSupabaseAdmin();
		const { error } = await supabase.from('orbitfs_settings').upsert({ scope_type: 'global', scope_id: '', key: KEY, value: enabled, updated_at: new Date().toISOString() }, { onConflict: 'scope_type,scope_id,key' });
		if (error) throw error;
		return json({ enabled, canManage: true });
	} catch (error: any) { return json({ error: error?.message || 'Request failed' }, { status: error?.status || 500 }); }
}
