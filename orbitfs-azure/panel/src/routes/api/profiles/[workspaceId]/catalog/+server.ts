import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getWorkspace, requireWorkspaceAccess, workspaceRole } from '$lib/server/workspaces';
import { profileCatalog } from '$lib/server/workspace-profiles.js';

export async function GET({ params, cookies }: any) {
	try {
		const user = await requireUser(cookies);
		await assertPanelLicensed();
		const workspace = await getWorkspace(params.workspaceId);
		const role = await requireWorkspaceAccess(user, workspace);
		return json(await profileCatalog(workspace.id, role, user.id, user.role));
	} catch (error: any) {
		return json({ error:String(error?.message || 'Could not load profile catalog') }, { status:Number(error?.status || 500) });
	}
}
