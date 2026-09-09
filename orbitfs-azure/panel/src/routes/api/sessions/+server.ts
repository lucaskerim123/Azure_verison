import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';

export async function GET({ cookies }) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();
		const supabase = getSupabaseAdmin();
		const sessions = await supabase.from('orbitfs_sessions').select('*').order('last_seen_at',{ascending:false});
		if (sessions.error) throw sessions.error;
		const userIds = [...new Set((sessions.data ?? []).map((row:any) => row.user_id).filter(Boolean))];
		let users = new Map<string,string>();
		if (userIds.length) {
			const rows = await supabase.from('orbitfs_users').select('id,username').in('id',userIds);
			if (rows.error) throw rows.error;
			users = new Map((rows.data ?? []).map((row:any) => [row.id,row.username]));
		}
		return json({ sessions:(sessions.data ?? []).map((row:any) => ({
			id:row.id,username:users.get(row.user_id) || 'Unknown',ip:row.ip_address,
			userAgent:row.user_agent,createdAt:row.created_at,lastSeenAt:row.last_seen_at,expiresAt:row.expires_at
		})) });
	} catch (error:any) { return json({ error:String(error?.message || 'Failed to load sessions') }, { status:Number(error?.status || 500) }); }
}
