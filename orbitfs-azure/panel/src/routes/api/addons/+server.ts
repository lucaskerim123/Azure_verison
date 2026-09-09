import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { isSystemAdmin } from '$lib/server/workspaces';
import { listCloudAddons } from '$lib/server/cloud-addons';

export async function GET({ cookies }) {
	const user = await requireUser(cookies);
	await assertPanelLicensed();
	if (!isSystemAdmin(user)) return json({ error:'System Owner or Admin required' }, { status:403 });
	return json({ addons:await listCloudAddons(), mode:'cloud' });
}
