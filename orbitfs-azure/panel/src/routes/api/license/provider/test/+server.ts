import { json } from '@sveltejs/kit';
import { getLicenseProviderDiagnostics } from '$lib/server/license';

export async function POST() {
	try {
		return json(await getLicenseProviderDiagnostics(), { headers: { 'cache-control': 'no-store' } });
	} catch (error: any) {
		return json({
			error: String(error?.message || 'Could not test licence system'),
			code: String(error?.code || 'LICENSE_PROVIDER_TEST_FAILED')
		}, { status: Number(error?.status || 400) });
	}
}
