import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { listEntries, purgeEntry } from '$lib/server/base-compat';

export async function POST({cookies}:any){
	try{
		await assertPanelLicensed(); await requireAdmin(cookies);
		const supabase=getSupabaseAdmin();
		const ws=await supabase.from('orbitfs_workspaces').select('id').eq('is_main',true).maybeSingle();
		if(ws.error)throw ws.error; if(!ws.data)return json({error:'Public Workspace not found'},{status:404});
		const entries=await listEntries(ws.data.id,'_trash');
		for(const entry of entries) await purgeEntry(ws.data.id,`_trash/${entry.name}`);
		return json({ok:true,emptied:entries.length});
	}catch(e:any){return json({error:String(e?.message||'Trash purge failed')},{status:Number(e?.status||500)})}
}