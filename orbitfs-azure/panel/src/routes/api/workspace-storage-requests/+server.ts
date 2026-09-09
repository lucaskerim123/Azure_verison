import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { isSystemAdmin } from '$lib/server/workspaces';

export async function GET({ cookies }) {
	try {
		const user = await requireUser(cookies);
		await assertPanelLicensed();
		const supabase = getSupabaseAdmin();
		const result = await supabase.from('orbitfs_workspace_requests').select('*')
			.eq('request_type','storage').order('created_at',{ascending:false});
		if (result.error) throw result.error;
		const rows = isSystemAdmin(user) ? (result.data ?? []) : (result.data ?? []).filter((row:any) => row.requested_by_id === user.id);
		return json({ requests:rows.map((row:any) => ({
			id:row.id,workspace_id:row.workspace_id,...(row.payload || {}),status:row.status,created_at:row.created_at,
			decided_at:row.decided_at
		})) });
	} catch (error:any) {
		return json({ error:String(error?.message || 'Could not load quota requests') }, { status:Number(error?.status || 500) });
	}
}