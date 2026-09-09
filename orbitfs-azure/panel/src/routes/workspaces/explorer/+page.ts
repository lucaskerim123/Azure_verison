import { redirect } from '@sveltejs/kit';

export function load({ url }) {
	throw redirect(307, url.search ? `/${url.search}` : '/');
}
