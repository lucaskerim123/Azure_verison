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
		const value = { enabled:body.enabled === true,message:String(body.message ?? '').slice(0,1000),updatedBy:admin.username,updatedAt:new Date().toISOString() };
		const supabase = getSupabaseAdmin();
		const saved = await supabase.from('orbitfs_settings').upsert({ scope_type:'global',scope_id:'',key:'maintenance',value },{ onConflict:'scope_type,scope_id,key' });
		if (saved.error) throw saved.error;
		await writeAudit({ actorUserId:admin.id,action:'system.maintenance.update',targetType:'system',targetId:'maintenance',detail:{ enabled:value.enabled } });
		return json(value);
	} catch (error:any) { return json({ error:String(error?.message || 'Failed to update maintenance status') }, { status:Number(error?.status || 500) }); }
}
