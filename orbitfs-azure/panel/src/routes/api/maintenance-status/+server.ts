import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';

export async function GET({ cookies }) {
	try {
		await requireUser(cookies);
		const supabase = getSupabaseAdmin();
		const result = await supabase.from('orbitfs_settings').select('value').eq('scope_type','global').eq('scope_id','').eq('key','maintenance').maybeSingle();
		if (result.error) throw result.error;
		const value = result.data?.value && typeof result.data.value === 'object' ? result.data.value as any : {};
		return json({ enabled:value.enabled === true,message:String(value.message || ''),updatedBy:value.updatedBy || null,updatedAt:value.updatedAt || null });
	} catch (error:any) { return json({ error:String(error?.message || 'Failed to load maintenance status') }, { status:Number(error?.status || 500) }); }
}
