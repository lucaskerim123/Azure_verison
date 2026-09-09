import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';

export async function PATCH({ request, cookies }) {
	try {
		const admin = await requireAdmin(cookies);
		await assertPanelLicensed();
		const body = await request.json().catch(() => ({}));
		const clientId = String(body.clientId ?? '').trim();
		const enabled = body.enabled !== false;
		if (enabled && !clientId) return json({ error:'Google OAuth client ID is required while Drive upload is enabled' }, { status:400 });
		const value = { clientId:clientId || null,enabled };
		const supabase = getSupabaseAdmin();
		const saved = await supabase.from('orbitfs_settings').upsert({ scope_type:'global',scope_id:'',key:'drive.google',value },{ onConflict:'scope_type,scope_id,key' });
		if (saved.error) throw saved.error;
		await writeAudit({ actorUserId:admin.id,action:'drive.config.update',targetType:'system',targetId:'drive.google',detail:{ enabled,configured:Boolean(clientId) } });
		return json({ clientId:value.clientId,enabled,configured:Boolean(clientId) });
	} catch (error:any) { return json({ error:String(error?.message || 'Drive config save failed') }, { status:Number(error?.status || 500) }); }
}
