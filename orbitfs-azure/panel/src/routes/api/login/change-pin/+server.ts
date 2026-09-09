import { json } from '@sveltejs/kit';
import { getSessionUser, hashPassword } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';

export async function POST({ request, cookies }) {
	const user = await getSessionUser(cookies);
	if (!user || !user.must_change_pin) return json({ error:'PIN change session is invalid' }, { status:401 });
	const body = await request.json().catch(() => ({}));
	const pin = String(body.pin ?? '');
	if (!/^\d{4,10}$/.test(pin) || pin === '0000') return json({ error:'Choose a new 4-10 digit PIN' }, { status:400 });
	const supabase = getSupabaseAdmin();
	const { error } = await supabase.from('orbitfs_users').update({ password_hash:hashPassword(pin), must_change_pin:false }).eq('id', user.id);
	if (error) return json({ error:error.message }, { status:500 });
	return json({ token:'cookie-session', username:user.username, role:user.role, email:user.email, mustChangePin:false });
}