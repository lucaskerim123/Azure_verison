import { json } from '@sveltejs/kit';

export const GET = async () => json({ ok: true, service: 'orbitfs-base', status: 'ready' }, { headers: { 'cache-control': 'no-store' } });
