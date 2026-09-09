import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { accessibleWorkspaces, workspaceRole } from '$lib/server/base-compat';
import { parseProfileUpload } from '$lib/server/profile-import';
import {
	blankProfileTemplate, createProfileBundle, createProfileEditRequest, deleteProfile,
	deleteProfileBundle, exportProfileState, importProfileState, listProfileEditRequests,
	profileCatalog, profileContext, profileModule, resolveProfileEditRequest,
	setProfilePermissions, setProfileSettings, setProfileSystemEnabled, setUserSlots,
	updateProfile, updateProfileBundle
} from '$lib/server/workspace-profiles.js';

const RESERVED = new Set(['settings','module-settings','slots','template','export','import','import-file','context','module','permissions','bundles','catalog','edit-requests']);

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

export async function GET({ params, cookies, url }) {
	try {
		const { user, role } = await context(cookies, params.workspaceId);
		const parts = String(params.rest || '').split('/').filter(Boolean);
		if (parts[0] === 'catalog') return json(await profileCatalog(params.workspaceId, role, user.id, user.role));
		if (parts[0] === 'template') return json({ template: blankProfileTemplate() });
		if (parts[0] === 'export') return json({ export: await exportProfileState(params.workspaceId, role, user.id, user.role) });
		if (parts[0] === 'edit-requests') return json(await listProfileEditRequests(params.workspaceId, role, user.id));
		if (parts[0] === 'context') return json(await profileContext(params.workspaceId, role, user.id, String(url.searchParams.get('mode') || 'summary'), user.role));
		if (parts[0] === 'module') return json(await profileModule(params.workspaceId, role, user.id, user.role));
		throw Object.assign(new Error('Profile route not found'), { status: 404 });
	} catch (error) { return failure(error); }
}

export async function POST({ params, cookies, request }) {
	try {
		const { user, role } = await context(cookies, params.workspaceId);
		const parts = String(params.rest || '').split('/').filter(Boolean);
		if (parts[0] === 'import-file') {
			const filename = decodeURIComponent(request.headers.get('x-filename') || 'Imported profile');
			const buffer = Buffer.from(await request.arrayBuffer());
			if (!buffer.length) throw Object.assign(new Error('Uploaded profile file is empty'), { status: 400 });
			const payload = await parseProfileUpload(buffer, filename, request.headers.get('content-type') || '');
			const replaceAll = String(request.headers.get('x-replace-all') || '').toLowerCase() === 'true';
			return json(await importProfileState(params.workspaceId, { ...payload, replaceAll }, user.username, role, user.id));
		}
		const body = await request.json().catch(() => ({}));
		if (parts[0] === 'import') return json(await importProfileState(params.workspaceId, body, user.username, role, user.id));
		if (parts[0] === 'edit-requests') return json({ request: await createProfileEditRequest(params.workspaceId, body, user.username, role, user.id, user.role) });
		if (parts[0] === 'bundles' && parts.length === 1) return json({ bundle: await createProfileBundle(params.workspaceId, body, user.username, role, user.id, user.role) });
		throw Object.assign(new Error('Profile route not found'), { status: 404 });
	} catch (error) { return failure(error); }
}

export async function PATCH({ params, cookies, request }) {
	try {
		const { user, role } = await context(cookies, params.workspaceId);
		const parts = String(params.rest || '').split('/').filter(Boolean);
		const body = await request.json().catch(() => ({}));
		if (parts[0] === 'settings') {
			if (!(user.role === 'owner' || user.role === 'admin' || role === 'owner')) throw Object.assign(new Error('Workspace owner access required'), { status: 403 });
			const state = await setProfileSystemEnabled(params.workspaceId, body.enabled, user.username);
			return json({ ok: true, enabled: state.enabled });
		}
		if (parts[0] === 'edit-requests' && parts[1]) return json(await resolveProfileEditRequest(params.workspaceId, parts[1], body, user.username, role, user.id, user.role));
		if (parts[0] === 'bundles' && parts[1]) return json({ bundle: await updateProfileBundle(params.workspaceId, parts[1], body, user.username, role, user.id, user.role) });
		if (parts[0] && !RESERVED.has(parts[0])) return json({ profile: await updateProfile(params.workspaceId, parts[0], body, user.username, role, user.id) });
		throw Object.assign(new Error('Profile route not found'), { status: 404 });
	} catch (error) { return failure(error); }
}

export async function PUT({ params, cookies, request }) {
	try {
		const { user, role } = await context(cookies, params.workspaceId);
		const parts = String(params.rest || '').split('/').filter(Boolean);
		const body = await request.json().catch(() => ({}));
		if (parts[0] === 'module-settings') return json({ settings: await setProfileSettings(params.workspaceId, body, user.username, role, user.id) });
		if (parts[0] === 'slots') return json({ slots: await setUserSlots(params.workspaceId, user.id, body, role) });
		if (parts[0] === 'permissions') return json(await setProfilePermissions(params.workspaceId, body, user.username, role, user.id));
		if (parts[0] === 'bundles' && parts[1]) return json({ bundle: await updateProfileBundle(params.workspaceId, parts[1], body, user.username, role, user.id, user.role) });
		if (parts[0] && !RESERVED.has(parts[0])) return json({ profile: await updateProfile(params.workspaceId, parts[0], body, user.username, role, user.id) });
		throw Object.assign(new Error('Profile route not found'), { status: 404 });
	} catch (error) { return failure(error); }
}

export async function DELETE({ params, cookies }) {
	try {
		const { user, role } = await context(cookies, params.workspaceId);
		const parts = String(params.rest || '').split('/').filter(Boolean);
		if (parts[0] === 'bundles' && parts[1]) return json(await deleteProfileBundle(params.workspaceId, parts[1], user.username, role, user.id));
		if (parts[0] && !RESERVED.has(parts[0])) return json(await deleteProfile(params.workspaceId, parts[0], user.username, role, user.id));
		throw Object.assign(new Error('Profile route not found'), { status: 404 });
	} catch (error) { return failure(error); }
}
