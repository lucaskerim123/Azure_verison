import { json } from '@sveltejs/kit';
import { getSupabaseAdmin } from '$lib/server/supabase';

const ROW_ID = 'phase1-default';

export async function GET() {
	try {
		const supabase = getSupabaseAdmin();
		const { data, error } = await supabase
			.from('orbitfs_phase1_state')
			.select('state, updated_at')
			.eq('id', ROW_ID)
			.maybeSingle();
		if (error) throw error;
		return json({ state: data?.state ?? null, updatedAt: data?.updated_at ?? null });
	} catch (error) {
		console.error('OrbitFS state GET failed', error);
		return json({ error: 'Database unavailable' }, { status: 500 });
	}
}

export async function PUT({ request }) {
	try {
		const body = await request.json();
		if (!body || typeof body.state !== 'object') {
			return json({ error: 'Invalid state payload' }, { status: 400 });
		}
		const supabase = getSupabaseAdmin();
		const { error } = await supabase.from('orbitfs_phase1_state').upsert({
			id: ROW_ID,
			state: body.state,
			updated_at: new Date().toISOString()
		});
		if (error) throw error;
		return json({ ok: true });
	} catch (error) {
		console.error('OrbitFS state PUT failed', error);
		return json({ error: 'Database write failed' }, { status: 500 });
	}
}
