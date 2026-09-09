import { json } from '@sveltejs/kit';
import { requireAdmin, hashPassword } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { normalizeUserPermissions, readRegistrationSettings } from '$lib/server/registration';
import { writeAudit } from '$lib/server/audit';

export async function POST({ params, request, cookies }: any) {
	try {
		const admin = await requireAdmin(cookies);
		await assertPanelLicensed();
		const parts = String(params.rest || '').split('/').filter(Boolean);
		if (!parts[0] || parts[1] !== 'respond') return json({ error:'Not found' }, { status:404 });
		const body = await request.json().catch(() => ({}));
		const approved = body.decision === 'approved';
		const supabase = getSupabaseAdmin();
		const found = await supabase.from('orbitfs_workspace_requests').select('*')
			.eq('id',parts[0]).eq('request_type','invitation').eq('status','pending').maybeSingle();
		if (found.error) throw found.error;
		if (!found.data) return json({ error:'Invitation request not found' }, { status:404 });
		const invitation:any = found.data;
		const username = String(invitation.payload?.username || '').trim();
		const permission = ['editor','contributor','viewer'].includes(String(invitation.payload?.permission)) ? String(invitation.payload.permission) : 'viewer';
		let target = await supabase.from('orbitfs_users').select('*').ilike('username',username).maybeSingle();
		if (target.error) throw target.error;
		if (approved && !target.data) {
			const settings = await readRegistrationSettings(false);
			const created = await supabase.from('orbitfs_users').insert({
				username, display_name:username, email:null, role:'user', status:'active',
				password_hash:hashPassword('0000'), must_change_pin:true,
				permissions:normalizeUserPermissions(settings.defaultPermissions)
			}).select('*').single();
			if (created.error || !created.data) throw created.error ?? new Error('Could not create invited user');
			target = { data:created.data, error:null } as any;
		}
		if (approved && target.data) {
			const member = await supabase.from('orbitfs_workspace_members').upsert({
				workspace_id:invitation.workspace_id,user_id:target.data.id,role:permission,mcp_enabled:false
			},{ onConflict:'workspace_id,user_id' });
			if (member.error) throw member.error;
			await supabase.from('orbitfs_notifications').insert({
				user_id:target.data.id,title:'Workspace invitation approved',
				body:`You were added to ${invitation.payload?.workspace_name || 'a workspace'} as ${permission}.`,level:'info'
			});
		}
		const status = approved ? 'approved':'denied';
		const updated = await supabase.from('orbitfs_workspace_requests').update({
			status,decided_by_id:admin.id,decided_at:new Date().toISOString(),
			payload:{ ...(invitation.payload || {}),response_message:String(body.message ?? '').slice(0,500) }
		}).eq('id',invitation.id).select('*').single();
		if (updated.error) throw updated.error;
		await writeAudit({ actorUserId:admin.id, workspaceId:invitation.workspace_id, action:approved ? 'workspace.invitation.approve' : 'workspace.invitation.deny', targetType:'workspace_invitation', targetId:invitation.id, detail:{ username,permission } });
		return json({ invitation:{ id:updated.data.id,workspace_id:updated.data.workspace_id,...updated.data.payload,status:updated.data.status,created_at:updated.data.created_at },user:target.data ? { username:target.data.username,role:target.data.role } : null });
	} catch (error:any) {
		return json({ error:String(error?.message || 'Could not respond to invitation') }, { status:Number(error?.status || 500) });
	}
}