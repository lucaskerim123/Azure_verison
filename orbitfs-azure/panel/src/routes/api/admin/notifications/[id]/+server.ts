import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';

export async function DELETE({ params, cookies }) {
	try {
		const admin = await requireAdmin(cookies);
		await assertPanelLicensed();
		const supabase = getSupabaseAdmin();
		const deleted = await supabase.from('orbitfs_notifications').delete().eq('id',params.id);
		if (deleted.error) throw deleted.error;
		await writeAudit({ actorUserId:admin.id,action:'admin.notification.delete',targetType:'notification',targetId:params.id });
		return json({ ok:true });
	} catch (error:any) { return json({ error:String(error?.message || 'Delete failed') }, { status:Number(error?.status || 500) }); }
}
