import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { isSystemAdmin, saveWorkspaceSettings } from '$lib/server/workspaces';

export async function PATCH({ request, cookies }) {
	try {
		const user = await requireUser(cookies);
		await assertPanelLicensed();
		if (!isSystemAdmin(user)) return json({ error:'System Owner or Admin required' }, { status:403 });
		const body = await request.json().catch(() => ({}));
		return json({ settings:await saveWorkspaceSettings(body) });
	} catch (error:any) {
		return json({ error:String(error?.message || 'Could not save workspace settings') }, { status:Number(error?.status || 500) });
	}
}