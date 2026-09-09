import { json } from '@sveltejs/kit';
import { getPanelLicenseSummary } from '$lib/server/license';

export async function GET({ url, request }) {
	// Background shell resyncs use refresh=1 too, so never let that flag alone
	// bypass the normal provider-validation interval. The dedicated licence screen
	// remains allowed to perform its explicit "Check now" action.
	const requestedRefresh = url.searchParams.get('refresh') === '1';
	let manual = url.searchParams.get('manual') === '1';
	if (!manual && requestedRefresh) {
		try {
			const referer = request.headers.get('referer');
			if (referer) {
				const path = new URL(referer).pathname;
				manual = path === '/license' || path.startsWith('/admin/license');
			}
		} catch {
			manual = false;
		}
	}
	const refresh = requestedRefresh && manual;
	try {
		return json(await getPanelLicenseSummary({ refresh }));
	} catch (error) {
		return json({
			valid: false,
			licensed: false,
			enforcement: true,
			reason: 'license_check_failed',
			refreshError: error instanceof Error ? error.message : 'License check failed'
		}, { status: 503 });
	}
}
