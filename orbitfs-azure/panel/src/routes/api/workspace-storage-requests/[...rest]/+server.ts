import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';

export async function POST({ params, request, cookies }: any) {
	try {
		const admin = await requireAdmin(cookies);
		await assertPanelLicensed();
		const parts = String(params.rest || '').split('/').filter(Boolean);
		if (!parts[0] || parts[1] !== 'respond') return json({ error:'Not found' }, { status:404 });
		const body = await request.json().catch(() => ({}));
		const supabase = getSupabaseAdmin();
		const found = await supabase.from('orbitfs_workspace_requests').select('*')
			.eq('id',parts[0]).eq('request_type','storage').eq('status','pending').maybeSingle();
		if (found.error) throw found.error;
		if (!found.data) return json({ error:'Request not found' }, { status:404 });
		const approved = body.decision === 'approved';
		const status = approved ? 'approved':'denied';
		if (approved) {
			const updatedWorkspace = await supabase.from('orbitfs_workspaces').update({ storage_quota_bytes:Number(found.data.payload?.requested_quota_bytes || 0) }).eq('id',found.data.workspace_id);
			if (updatedWorkspace.error) throw updatedWorkspace.error;
		}		const payload = { ...(found.data.payload || {}),response_message:String(body.message ?? '').slice(0,500) };
		const updated = await supabase.from('orbitfs_workspace_requests').update({
			status,decided_by_id:admin.id,decided_at:new Date().toISOString(),payload
		}).eq('id',found.data.id).select('*').single();
		if (updated.error) throw updated.error;
		if (found.data.requested_by_id) await supabase.from('orbitfs_notifications').insert({
			user_id:found.data.requested_by_id,
			title:`Quota request ${status}`,
			body:`${payload.workspace_name || 'Workspace'} quota request was ${status} by ${admin.username}.`,
			level:approved ? 'info':'warning'
		});
		return json({ request:{ id:updated.data.id,workspace_id:updated.data.workspace_id,...payload,status:updated.data.status,created_at:updated.data.created_at } });
	} catch (error:any) {
		return json({ error:String(error?.message || 'Could not respond to quota request') }, { status:Number(error?.status || 500) });
	}
}