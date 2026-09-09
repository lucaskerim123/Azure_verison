import { json } from '@sveltejs/kit';
import { authenticateOrbitCredentials, createSession } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';

export async function POST({ request, cookies, url, getClientAddress }) {
	const body = await request.json().catch(() => ({}));
	const identity = String(body.identity ?? body.username ?? '').trim();
	const credential = String(body.password ?? body.pin ?? '');
	if (!identity || !credential) return json({ error:'Username/email and password or PIN are required' }, { status:400 });
	const supabase = getSupabaseAdmin();
	let user;
	try { user = await authenticateOrbitCredentials(identity, credential); }
	catch { return json({ error:'Login failed' }, { status:500 }); }
	if (!user) return json({ error:'Invalid username or password' }, { status:401 });
	if (user.status === 'banned') return json({ error:user.ban_reason ? `Account banned: ${user.ban_reason}` : 'Account banned' }, { status:403 });
	if (user.status === 'inactive') return json({ error:'Account is inactive' }, { status:403 });
	let ip: string | null = null;
	try { ip = getClientAddress(); } catch { ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null; }
	await supabase.from('orbitfs_users').update({
		last_ip:ip, last_user_agent:request.headers.get('user-agent'), last_login_at:new Date().toISOString(),
		login_count:Number(user.login_count || 0) + 1
	}).eq('id', user.id);
	await createSession(user.id, cookies, { userAgent:request.headers.get('user-agent'), ip, secure:url.protocol === 'https:' });
	await writeAudit({ actorUserId:user.id, action:'auth.login', targetType:'user', targetId:user.id, ip, userAgent:request.headers.get('user-agent') });
	const { password_hash:_, ...safeUser } = user;
	return json({ token:'cookie-session', username:user.username, role:user.role, email:user.email, mustChangePin:Boolean(user.must_change_pin), user:safeUser });
}