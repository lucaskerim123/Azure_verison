import { json } from '@sveltejs/kit';
import { createSession, hashPassword } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { USER_CAPABILITIES } from '$lib/server/registration';
import { writeAudit } from '$lib/server/audit';
import { ensureDefaultWorkspace, getBaseSetupState } from '$lib/server/setup';

export async function POST({ request, cookies, url, getClientAddress }) {
	try {
		const state = await getBaseSetupState();
		if (!state.coreReady) {
			return json({ error: 'OrbitFS Base core services are not ready. Finish the core setup checks first.' }, { status: 503 });
		}
		if (!state.licenseReady) {
			return json({ error: 'Activate the OrbitFS Base System licence before creating the first Owner.' }, { status: 402 });
		}
		if (state.ownerExists) return json({ error: 'First owner already exists' }, { status: 409 });

		const body = await request.json().catch(() => ({}));
		const username = String(body.username ?? '').trim();
		const pin = String(body.pin ?? '');
		const email = String(body.email ?? '').trim().toLowerCase() || null;
		if (!/^[a-zA-Z0-9._-]{2,40}$/.test(username)) return json({ error: 'Username must be 2-40 letters, numbers, dots, underscores or dashes' }, { status: 400 });
		if (!/^\d{4,10}$/.test(pin) || pin === '0000') return json({ error: 'Choose a 4-10 digit PIN other than 0000' }, { status: 400 });
		if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address' }, { status: 400 });

		const supabase = getSupabaseAdmin();
		const permissions = Object.fromEntries(USER_CAPABILITIES.map((key) => [key, true]));
		const { data: user, error: userError } = await supabase.from('orbitfs_users').insert({
			username,
			display_name: username,
			email,
			password_hash: hashPassword(pin),
			role: 'owner',
			status: 'active',
			permissions,
			must_change_pin: false
		}).select('id,username,display_name,email,role,status,avatar_url,permissions,must_change_pin').single();
		if (userError || !user) throw userError ?? new Error('Could not create first owner');

		let publicWorkspaceId: string | null = null;
		try {
			publicWorkspaceId = await ensureDefaultWorkspace(String(user.id));
		} catch (setupError) {
			await supabase.from('orbitfs_workspace_members').delete().eq('user_id', user.id);
			await supabase.from('orbitfs_users').delete().eq('id', user.id);
			throw setupError;
		}

		let ip: string | null = null;
		try {
			ip = getClientAddress();
		} catch {
			ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
		}
		await createSession(user.id, cookies, {
			userAgent: request.headers.get('user-agent'),
			ip,
			secure: url.protocol === 'https:'
		});
		await writeAudit({
			actorUserId: user.id,
			workspaceId: publicWorkspaceId,
			action: 'setup.owner',
			targetType: 'user',
			targetId: user.id,
			ip,
			userAgent: request.headers.get('user-agent')
		});
		return json({ token: 'cookie-session', username: user.username, role: 'owner', email: user.email, mustChangePin: false });
	} catch (error: any) {
		return json({ error: error?.message ?? 'Could not create first owner' }, { status: Number(error?.status || 500) });
	}
}
