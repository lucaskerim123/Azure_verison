import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { isSystemAdmin } from '$lib/server/workspaces';
import { deleteVercelConnection, getVercelConnectionSummary, saveVercelConnection } from '$lib/server/vercel-connection';

function fail(error: any) {
	return json({ error: String(error?.message || 'Vercel connection request failed'), code: String(error?.code || 'VERCEL_CONNECTION_FAILED') }, { status: Number(error?.status || 500) });
}

async function context(cookies: any) {
	const user = await requireUser(cookies);
	await assertPanelLicensed();
	if (!isSystemAdmin(user)) throw Object.assign(new Error('System Owner or Admin required'), { status: 403 });
	return user;
}

export async function GET({ cookies }: any) {
	try {
		await context(cookies);
		return json(await getVercelConnectionSummary(), { headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		return fail(error);
	}
}

export async function POST({ request, cookies }: any) {
	try {
		await context(cookies);
		const body = await request.json().catch(() => ({}));
		const summary = await saveVercelConnection(body?.token, body?.teamId);
		return json({ ok: true, ...summary }, { headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		return fail(error);
	}
}

export async function DELETE({ cookies }: any) {
	try {
		await context(cookies);
		return json({ ok: true, ...(await deleteVercelConnection()) }, { headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		return fail(error);
	}
}
