import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';

export async function POST({ cookies }) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();
		return json({ error:'Hard stop is not available in Vercel cloud mode. Runtime lifecycle is managed by Vercel.' }, { status:409 });
	} catch (error:any) { return json({ error:String(error?.message || 'Hard stop unavailable') }, { status:Number(error?.status || 500) }); }
}
