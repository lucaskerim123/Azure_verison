import { json } from '@sveltejs/kit';
import { getLicenseProviderDiagnostics } from '$lib/server/license';

export async function GET() {
	try {
		return json(await getLicenseProviderDiagnostics(), { headers: { 'cache-control': 'no-store' } });
	} catch (error: any) {
		return json({ error: String(error?.message || 'Could not diagnose licence API') }, { status: 500 });
	}
}
