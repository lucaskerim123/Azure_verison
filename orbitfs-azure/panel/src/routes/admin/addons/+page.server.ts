import { redirect } from '@sveltejs/kit';
import { getSharedEngineHostState } from '$lib/server/engine-host-state';
import { engineHostProvisioningAvailable } from '$lib/server/vercel-engine-provision';

export async function load() {
	const [host, available] = await Promise.all([getSharedEngineHostState(), engineHostProvisioningAvailable()]);
	if (host.state === 'not_deployed' && !host.hostUrl && !available) {
		throw redirect(303, '/setup/vercel?next=/admin/engines');
	}
	return {};
}
