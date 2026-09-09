import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { isSystemAdmin } from '$lib/server/workspaces';
import { getSharedEngineHostState } from '$lib/server/engine-host-state';
import { engineHostProvisioningAvailable } from '$lib/server/vercel-engine-provision';
import { getVercelConnectionSummary } from '$lib/server/vercel-connection';

const fail = (error:any) => json({error:String(error?.message||'Shared Engine Host request failed'),code:String(error?.code||'ENGINE_HOST_ERROR')},{status:Number(error?.status||500)});

async function context(cookies:any) {
	const user=await requireUser(cookies);
	await assertPanelLicensed();
	if(!isSystemAdmin(user)) throw Object.assign(new Error('System Owner or Admin required'),{status:403});
	return user;
}

export async function GET({cookies}:any) {
	try {
		await context(cookies);
		return json({
			host:await getSharedEngineHostState(),
			provisioningAvailable:await engineHostProvisioningAvailable(),
			vercelConnection:await getVercelConnectionSummary(),
			provider:'vercel'
		},{headers:{'cache-control':'no-store'}});
	} catch(error) {
		return fail(error);
	}
}
