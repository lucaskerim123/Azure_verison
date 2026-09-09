import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';

export async function GET({ cookies }) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();
		return json({ ready:false,scriptExists:false,passwordConfigured:false,cloudMode:true });
	} catch (error:any) { return json({ error:String(error?.message || 'Failed to load hard-stop status') }, { status:Number(error?.status || 500) }); }
}
