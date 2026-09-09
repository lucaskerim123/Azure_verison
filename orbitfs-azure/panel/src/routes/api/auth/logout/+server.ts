import { json } from '@sveltejs/kit';
import { destroySession, getSessionUser } from '$lib/server/auth';
import { writeAudit } from '$lib/server/audit';

export async function POST({ cookies, request }) {
	const user = await getSessionUser(cookies);
	await destroySession(cookies);
	if (user) {
		await writeAudit({
			actorUserId: user.id,
			action: 'auth.logout',
			targetType: 'user',
			targetId: user.id,
			userAgent: request.headers.get('user-agent')
		});
	}
	return json({ ok: true });
}
