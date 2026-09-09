import { redirect } from '@sveltejs/kit';

export function load({ url }: { url: URL }) {
	if (url.searchParams.get('setup') === '1') {
		throw redirect(303, '/setup');
	}

	return {};
}
