import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';

async function readRetention() {
	const supabase=getSupabaseAdmin();
	const row=await supabase.from('orbitfs_settings').select('value').eq('scope_type','global').eq('scope_id','').eq('key','trash_retention_days').maybeSingle();
	if (row.error) throw row.error;
	return Math.max(1,Number(row.data?.value ?? 30));
}
export async function GET({cookies}:any){try{await assertPanelLicensed();await requireAdmin(cookies);return json({retentionDays:await readRetention()});}catch(e:any){return json({error:String(e?.message||'Failed')},{status:Number(e?.status||500)})}}
export async function POST({request,cookies}:any){try{await assertPanelLicensed();await requireAdmin(cookies);const body=await request.json().catch(()=>({}));const retentionDays=Math.max(1,Math.min(3650,Math.round(Number(body.retentionDays)||30)));const supabase=getSupabaseAdmin();const saved=await supabase.from('orbitfs_settings').upsert({scope_type:'global',scope_id:'',key:'trash_retention_days',value:retentionDays},{onConflict:'scope_type,scope_id,key'});if(saved.error)throw saved.error;return json({retentionDays});}catch(e:any){return json({error:String(e?.message||'Failed')},{status:Number(e?.status||500)})}}