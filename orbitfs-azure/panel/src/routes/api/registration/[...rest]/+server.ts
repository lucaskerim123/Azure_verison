import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { writeAudit } from '$lib/server/audit';
import {
	readRegistrationSettings,
	saveRegistrationSettings,
	resolveRegistrationRequest
} from '$lib/server/registration';

function failure(error: any) {
	return json({ error:error?.message ?? 'Registration request failed' }, { status:Number(error?.status || 500) });
}

export async function GET({ params, cookies }) {
	try {
		await assertPanelLicensed();
		const rest = String(params.rest || '');
		if (rest === 'status') {
			const settings = await readRegistrationSettings(false);
			return json({ mode:settings.mode, available:settings.mode === 'open' || settings.mode === 'approval_queue', queueMode:settings.mode === 'approval_queue' });
		}
		await requireAdmin(cookies);
		if (rest === 'settings') return json(await readRegistrationSettings(true));
		return json({ error:'Not found' }, { status:404 });
	} catch (error) { return failure(error); }
}
export async function PATCH({ params, request, cookies }) {
	try {
		await assertPanelLicensed();
		await requireAdmin(cookies);
		if (String(params.rest || '') !== 'settings') return json({ error:'Not found' }, { status:404 });
		return json(await saveRegistrationSettings(await request.json().catch(() => ({}))));
	} catch (error) { return failure(error); }
}

export async function POST({ params, cookies }) {
	try {
		await assertPanelLicensed();
		const actor = await requireAdmin(cookies);
		const parts = String(params.rest || '').split('/').filter(Boolean);
		if (parts[0] !== 'requests' || !parts[1] || !['approve','reject'].includes(parts[2])) return json({ error:'Not found' }, { status:404 });
		const approved = parts[2] === 'approve';
		const result = await resolveRegistrationRequest(parts[1], approved, actor.id);
		await writeAudit({ actorUserId:actor.id, action:approved ? 'registration.approve' : 'registration.reject', targetType:'registration_request', targetId:parts[1] });
		return json({ ok:true, ...result });
	} catch (error) { return failure(error); }
}