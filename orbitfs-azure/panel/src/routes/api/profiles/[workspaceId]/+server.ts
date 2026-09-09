import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { accessibleWorkspaces, workspaceRole } from '$lib/server/base-compat';
import { createProfile, profileOverview } from '$lib/server/workspace-profiles.js';

async function context(cookies: any, workspaceId: string) {
	const user = await requireUser(cookies);
	await assertPanelLicensed();
	const workspace = (await accessibleWorkspaces(user)).find((item) => item.id === workspaceId);
	if (!workspace) throw Object.assign(new Error('Workspace access denied'), { status: 403 });
	const role = await workspaceRole(user, workspaceId) ?? 'viewer';
	return { user, workspace, role };
}

function failure(error: any) {
	return json({ error: String(error?.message || 'Profile request failed'), code: error?.code || 'PROFILE_REQUEST_FAILED' }, { status: Number(error?.status || 500) });
}

export async function GET({ params, cookies }) {
	try {
		const { user, workspace, role } = await context(cookies, params.workspaceId);
		return json({ workspace, ...(await profileOverview(params.workspaceId, role, user.id, user.role)) });
	} catch (error) { return failure(error); }
}

export async function POST({ params, cookies, request }) {
	try {
		const { user, role } = await context(cookies, params.workspaceId);
		const body = await request.json().catch(() => ({}));
		const profile = await createProfile(params.workspaceId, body, user.username, role, user.id);
		return json({ profile });
	} catch (error) { return failure(error); }
}
