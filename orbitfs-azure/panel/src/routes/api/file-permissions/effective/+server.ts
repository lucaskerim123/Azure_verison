import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';

const normalize = (value:unknown) => String(value ?? '').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
const fallback = { read:true,write:false,download:false,move:false,delete:false,create:false,share:false };
const values = (row:any) => ({ read:row.can_view===true,write:row.can_edit===true,download:row.can_download===true,
	move:row.can_move===true,delete:row.can_delete===true,create:row.can_create===true,share:row.can_share===true });

export async function GET({ url, cookies }) {
	try {
		await requireAdmin(cookies); await assertPanelLicensed();
		const path = normalize(url.searchParams.get('path')); const supabase = getSupabaseAdmin();
		const workspace = await supabase.from('orbitfs_workspaces').select('id').eq('is_main',true).maybeSingle();
		if (workspace.error) throw workspace.error; if (!workspace.data) return json({ error:'Public Workspace not found' }, { status:404 });
		const result = await supabase.from('orbitfs_file_permissions').select('*').eq('workspace_id',workspace.data.id)
			.eq('principal_type','role').eq('principal_id','viewer');
		if (result.error) throw result.error;
		const matching = (result.data ?? []).filter((row:any) => { const prefix=normalize(row.path_prefix); return !prefix || path===prefix || path.startsWith(prefix+'/'); })
			.sort((a:any,b:any) => normalize(b.path_prefix).length-normalize(a.path_prefix).length);
		return json({ path,permissions:matching[0] ? values(matching[0]) : fallback });
	} catch (error:any) { return json({ error:String(error?.message || 'Lookup failed') }, { status:Number(error?.status || 500) }); }
}
