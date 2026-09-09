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
		let query = supabase.from('orbitfs_workspace_requests').select('*').eq('request_type','invitation').order('created_at',{ascending:false});
		const result = await query;
		if (result.error) throw result.error;
		let rows = result.data ?? [];
		if (!isSystemAdmin(user)) rows = rows.filter((row:any) => row.requested_by_id === user.id);
		return json({ invitations:rows.map((row:any) => ({
			id:row.id,workspace_id:row.workspace_id,workspace_name:row.payload?.workspace_name || '',
			username:row.payload?.username || '',permission:row.payload?.permission || 'viewer',status:row.status,
			requested_by_username:row.payload?.requested_by_username || '',created_at:row.created_at
		})) });
	} catch (error:any) {
		return json({ error:String(error?.message || 'Could not load invitations') }, { status:Number(error?.status || 500) });
	}
}