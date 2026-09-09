import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';

const normalize = (value:unknown) => String(value ?? '').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
const values = (row:any) => ({ read:row.can_view===true,write:row.can_edit===true,download:row.can_download===true,
	move:row.can_move===true,delete:row.can_delete===true,create:row.can_create===true,share:row.can_share===true });
async function mainWorkspace() {
	const supabase = getSupabaseAdmin();
	const result = await supabase.from('orbitfs_workspaces').select('id').eq('is_main',true).maybeSingle();
	if (result.error) throw result.error;
	if (!result.data) throw Object.assign(new Error('Public Workspace not found'), { status:404 });
	return result.data.id;
}

export async function GET({ cookies }) {
	try {
		await requireAdmin(cookies); await assertPanelLicensed();
		const workspaceId = await mainWorkspace(); const supabase = getSupabaseAdmin();
		const result = await supabase.from('orbitfs_file_permissions').select('*').eq('workspace_id',workspaceId)
			.eq('principal_type','role').eq('principal_id','viewer').order('path_prefix');
		if (result.error) throw result.error;
		return json({ rules:(result.data ?? []).map((row:any) => ({ path:normalize(row.path_prefix),permissions:values(row) })) });
	} catch (error:any) { return json({ error:String(error?.message || 'Failed to load rules') }, { status:Number(error?.status || 500) }); }
}
export async function POST({ request, cookies }) {
	try {
		const admin = await requireAdmin(cookies); await assertPanelLicensed();
		const body = await request.json().catch(() => ({}));
		const path = normalize(body.path); const p = body.permissions && typeof body.permissions === 'object' ? body.permissions : {};
		const workspaceId = await mainWorkspace(); const supabase = getSupabaseAdmin();
		await supabase.from('orbitfs_file_permissions').delete().eq('workspace_id',workspaceId).eq('path_prefix',path)
			.eq('principal_type','role').eq('principal_id','viewer');
		const saved = await supabase.from('orbitfs_file_permissions').insert({ workspace_id:workspaceId,path_prefix:path,
			principal_type:'role',principal_id:'viewer',can_view:p.read===true,can_edit:p.write===true,can_download:p.download===true,
			can_move:p.move===true,can_delete:p.delete===true,can_create:p.create===true,can_share:p.share===true,
			can_manage_permissions:false,inherit:true });
		if (saved.error) throw saved.error;
		await writeAudit({ actorUserId:admin.id,workspaceId,action:'permissions.viewer.save',targetType:'path',targetId:path || '/',detail:{ permissions:p } });
		return json({ ok:true });
	} catch (error:any) { return json({ error:String(error?.message || 'Save failed') }, { status:Number(error?.status || 500) }); }
}

export async function DELETE({ url, cookies }) {
	try {
		const admin = await requireAdmin(cookies); await assertPanelLicensed();
		const path = normalize(url.searchParams.get('path')); const workspaceId = await mainWorkspace(); const supabase = getSupabaseAdmin();
		const deleted = await supabase.from('orbitfs_file_permissions').delete().eq('workspace_id',workspaceId).eq('path_prefix',path)
			.eq('principal_type','role').eq('principal_id','viewer');
		if (deleted.error) throw deleted.error;
		await writeAudit({ actorUserId:admin.id,workspaceId,action:'permissions.viewer.delete',targetType:'path',targetId:path || '/' });
		return json({ ok:true });
	} catch (error:any) { return json({ error:String(error?.message || 'Delete failed') }, { status:Number(error?.status || 500) }); }
}
