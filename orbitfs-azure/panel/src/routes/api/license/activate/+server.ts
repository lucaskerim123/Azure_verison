import { json } from '@sveltejs/kit';
import { activatePanelLicense, clearPanelLicense } from '$lib/server/license';
import { writeAudit } from '$lib/server/audit';

export async function POST({ request }) {
	const body = await request.json().catch(() => ({}));
	const licenseKey = String(body.licenseKey ?? '').trim();
	if (!licenseKey) return json({ error: 'Licence key is required' }, { status: 400 });

	try {
		const summary = await activatePanelLicense(licenseKey);
		await writeAudit({
			actorUserId: null,
			action: 'license.activate',
			targetType: 'license',
			targetId: 'primary',
			detail: { component: 'orbitfs_base', keyHint: summary.keyHint, installationId: summary.installationId }
		}).catch(() => {});
		return json({ ok: true, license: summary });
	} catch (error: any) {
		return json({
			error: String(error?.message || 'Licence activation failed'),
			code: String(error?.code || 'LICENSE_ACTIVATION_FAILED')
		}, { status: Number(error?.status || 403) });
	}
}

export async function DELETE() {
	try {
		const summary = await clearPanelLicense();
		await writeAudit({
			actorUserId: null,
			action: 'license.clear_local',
			targetType: 'license',
			targetId: 'primary',
			detail: { installationId: summary.installationId }
		}).catch(() => {});
		return json({ ok: true, license: summary });
	} catch (error: any) {
		return json({
			error: String(error?.message || 'Could not clear local licence state'),
			code: String(error?.code || 'LICENSE_CLEAR_FAILED')
		}, { status: Number(error?.status || 500) });
	}
}
