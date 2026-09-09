import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';

export async function GET({ cookies }) {
	const user = await requireUser(cookies);
	const supabase = getSupabaseAdmin();
	const { data, error } = await supabase.from('orbitfs_notifications').select('*').or(`user_id.is.null,user_id.eq.${user.id}`).order('created_at', { ascending: false }).limit(200);
	if (error) return json({ error: error.message }, { status: 500 });
	return json({ notifications: data ?? [] });
}

export async function POST({ request, cookies }) {
	const user = await requireUser(cookies);
	const body = await request.json().catch(() => ({}));
	const action = String(body.action ?? '');
	const supabase = getSupabaseAdmin();
	if (action === 'read') {
		const id = String(body.id ?? '');
		const { data: item } = await supabase.from('orbitfs_notifications').select('user_id').eq('id', id).maybeSingle();
		if (!item || (item.user_id && item.user_id !== user.id)) return json({ error: 'Notification not found' }, { status: 404 });
		const { error } = await supabase.from('orbitfs_notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
		if (error) return json({ error: error.message }, { status: 500 });
		return json({ ok: true });
	}
	if (action === 'readAll') {
		const now = new Date().toISOString();
		const { error: ownError } = await supabase.from('orbitfs_notifications').update({ read_at: now }).eq('user_id', user.id).is('read_at', null);
		if (ownError) return json({ error: ownError.message }, { status: 500 });
		return json({ ok: true });
	}
	return json({ error: 'Unknown notification action' }, { status: 400 });
}
