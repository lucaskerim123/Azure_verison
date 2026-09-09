import { json } from '@sveltejs/kit';
import { createSession } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { writeAudit } from '$lib/server/audit';
import { getSupabaseAdmin } from '$lib/server/supabase';
import {
	readRegistrationSettings, validateAccountInput, usernameAvailable, emailAvailable,
	queueRegistrationRequest, createRegisteredUser
} from '$lib/server/registration';

export async function POST({ request, cookies, url, getClientAddress }) {
	try {
		await assertPanelLicensed();
		const supabase = getSupabaseAdmin();
		const { count } = await supabase.from('orbitfs_users').select('*', { count:'exact', head:true });
		if ((count ?? 0) === 0) return json({ error:'Create the first owner through setup first' }, { status:409 });
		const settings = await readRegistrationSettings(false);
		if (settings.mode === 'off') return json({ error:'Registration is currently closed' }, { status:403 });
		const account = validateAccountInput(await request.json().catch(() => ({})));
		if (!await usernameAvailable(account.username)) return json({ error:'Username is already taken or pending approval' }, { status:409 });
		if (!await emailAvailable(account.email)) return json({ error:'That email address is already registered' }, { status:409 });

		if (settings.mode === 'approval_queue') {
			const queued = await queueRegistrationRequest(account);
			return json({ ok:true, pending:true, request:queued });
		}

		const user = await createRegisteredUser(account);
		let ip: string | null = null;
		try { ip = getClientAddress(); } catch { ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null; }
		await createSession(user.id, cookies, { userAgent:request.headers.get('user-agent'), ip, secure:url.protocol === 'https:' });
		await writeAudit({ actorUserId:user.id, action:'auth.register', targetType:'user', targetId:user.id, ip, userAgent:request.headers.get('user-agent') });
		return json({ token:'cookie-session', username:user.username, role:user.role, email:user.email, mustChangePin:false, user });
	} catch (error: any) {
		return json({ error:error?.message ?? 'Registration failed' }, { status:Number(error?.status || 500) });
	}
}