import { redirect, type Handle } from '@sveltejs/kit';
import { getPanelLicenseSummary } from '$lib/server/license';

const PUBLIC_PATHS = new Set([
	'/license',
	'/api/license/status',
	'/api/license/activate',
	'/api/license/provider',
	'/api/license/provider/test',
	'/api/license/diagnostics',
	'/api/auth/logout'
]);

const OAUTH_MACHINE_POSTS = new Set(['/oauth/token', '/oauth/register']);
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

function bypassLicense(pathname: string, method: string) {
	if (method === 'OPTIONS') return true;
	if (PUBLIC_PATHS.has(pathname)) return true;
	if (pathname.startsWith('/_app/') || pathname.startsWith('/favicon') || pathname.startsWith('/robots')) return true;
	return false;
}

function csrfBlocked(event: Parameters<Handle>[0]['event']) {
	if (!UNSAFE_METHODS.has(event.request.method)) return false;
	if (OAUTH_MACHINE_POSTS.has(event.url.pathname)) return false;
	const contentType = event.request.headers.get('content-type') || '';
	if (!FORM_TYPES.some((type) => contentType.startsWith(type))) return false;
	const origin = event.request.headers.get('origin');
	if (!origin) return false;
	return origin !== event.url.origin;
}

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	if (csrfBlocked(event)) {
		return new Response('Cross-site form submission blocked', {
			status: 403,
			headers: { 'cache-control': 'no-store' }
		});
	}
	if (bypassLicense(pathname, event.request.method)) return resolve(event);

	let summary;
	try {
		summary = await getPanelLicenseSummary();
	} catch (error) {
		summary = {
			licensed: false,
			reason: 'license_check_failed',
			refreshError: error instanceof Error ? error.message : 'License check failed'
		};
	}

	if (!summary.licensed) {
		if (pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/oauth/')) {
			return new Response(JSON.stringify({
				error: 'OrbitFS Base System licence is required',
				code: 'LICENSE_REQUIRED',
				license: summary,
				restricted: true
			}), {
				status: 403,
				headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
			});
		}
		const next = encodeURIComponent(`${pathname}${event.url.search}`);
		throw redirect(303, `/license?next=${next}`);
	}

	return resolve(event);
};
