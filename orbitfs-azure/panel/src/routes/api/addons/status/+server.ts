import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { listCloudAddons } from '$lib/server/cloud-addons';

export async function GET({ cookies }) {
	await requireUser(cookies);
	return json({ addons: await listCloudAddons(), mode: 'cloud' });
}
