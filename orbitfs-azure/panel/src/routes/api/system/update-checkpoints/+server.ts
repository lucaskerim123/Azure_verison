import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { createUpdateCheckpoint, listUpdateCheckpoints } from '$lib/server/update-checkpoints';
import { writeAudit } from '$lib/server/audit';

export async function GET({ cookies }) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();
		return json({ checkpoints: await listUpdateCheckpoints() });
	} catch (error: any) {
		return json({ error: String(error?.message || 'Failed to load update checkpoints') }, { status: Number(error?.status || 500) });
	}
}

export async function POST({ request, cookies, url }) {
	try {
		const admin = await requireAdmin(cookies);
		await assertPanelLicensed();
		const body = await request.json().catch(() => ({}));
		const checkpoint = await createUpdateCheckpoint({
			actor: { id: admin.id, username: admin.username },
			targetVersion: body.targetVersion,
			reason: body.reason,
			origin: url.origin
		});
		await writeAudit({
			actorUserId: admin.id,
			action: 'system.update.checkpoint.create',
			targetType: 'update_checkpoint',
			targetId: checkpoint.id,
			detail: { targetVersion: checkpoint.targetVersion, fingerprint: checkpoint.fingerprint }
		});
		return json({ ok: true, checkpoint });
	} catch (error: any) {
		return json({ error: String(error?.message || 'Failed to create update checkpoint') }, { status: Number(error?.status || 500) });
	}
}
