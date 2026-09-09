import { json } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';

export async function GET({ cookies }) {
	const user = await getSessionUser(cookies);
	if (!user) return json({ authenticated: false, user: null });
	const supabase = getSupabaseAdmin();
	const { count } = await supabase
		.from('orbitfs_notifications')
		.select('*', { count: 'exact', head: true })
		.or(`user_id.is.null,user_id.eq.${user.id}`)
		.is('read_at', null);
	return json({ authenticated: true, user, unreadNotifications: count ?? 0 });
}
