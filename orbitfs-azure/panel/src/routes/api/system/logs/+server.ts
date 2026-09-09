import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';

export async function GET({ cookies, url }) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();
		const supabase = getSupabaseAdmin();
		const result = await supabase.from('orbitfs_audit_log').select('*').order('created_at',{ascending:false}).limit(500);
		if (result.error) throw result.error;
		const actorIds = [...new Set((result.data ?? []).map((row:any) => row.actor_user_id).filter(Boolean))];
		let names = new Map<string,string>();
		if (actorIds.length) {
			const users = await supabase.from('orbitfs_users').select('id,username').in('id',actorIds);
			if (users.error) throw users.error;
			names = new Map((users.data ?? []).map((row:any) => [row.id,row.username]));
		}
		const lines = (result.data ?? []).map((row:any) => JSON.stringify({
			ts:row.created_at,event:row.action,user:names.get(row.actor_user_id) || null,
			workspace_id:row.workspace_id,target_type:row.target_type,target_id:row.target_id,
			...(row.detail || {}),ip:row.ip_address,user_agent:row.user_agent
		}));
		return json({ which:url.searchParams.get('which') || 'panel-events',lines });
	} catch (error:any) { return json({ error:String(error?.message || 'Failed to load logs'),lines:[] }, { status:Number(error?.status || 500) }); }
}
