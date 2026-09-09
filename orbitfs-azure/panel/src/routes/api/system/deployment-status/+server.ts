import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';

export async function GET({ cookies, url }) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();
		return json({
			platform:'Vercel',
			environment:process.env.VERCEL_ENV || 'local',
			branch:process.env.VERCEL_GIT_COMMIT_REF || 'main',
			commit:process.env.VERCEL_GIT_COMMIT_SHA || null,
			commitMessage:process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
			deploymentUrl:process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : url.origin,
			productionUrl:url.origin,
			provider:'GitHub → Vercel',
			managed:true,
			checkedAt:new Date().toISOString()
		});
	} catch (error:any) {
		return json({ error:String(error?.message || 'Failed to load deployment status') }, { status:Number(error?.status || 500) });
	}
}