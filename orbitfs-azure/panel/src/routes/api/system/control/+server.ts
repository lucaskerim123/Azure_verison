import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';

const CLOUD_TARGETS = {
	panel: { state:'running', operational:true, residentProcess:false, managedBy:'Vercel' },
	runtime: { state:'running', operational:true, residentProcess:false, managedBy:'Vercel' }
} as const;

export async function POST({ request, cookies }) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();
		const body = await request.json().catch(() => ({}));
		const target = String(body.target ?? 'runtime').toLowerCase();
		const action = String(body.action ?? body.command ?? 'status').toLowerCase();
		const current = CLOUD_TARGETS[target as keyof typeof CLOUD_TARGETS];
		if (!current) return json({ error:'Legacy resident-service controls are not available in OrbitFS Cloud.', target, mode:'serverless' }, { status:410 });
		if (action === 'status' || action === 'refresh') return json({ target, ...current, mode:'serverless', message:'Runtime state is managed by Vercel.' });
		return json({ error:`${target} cannot be ${action}ed as a resident service.`, target, requestedAction:action, current, mode:'serverless', note:'Deployments and runtime lifecycle are managed by Vercel.' }, { status:409 });
	} catch (error:any) {
		return json({ error:String(error?.message || 'Control action failed') }, { status:Number(error?.status || 500) });
	}
}
