import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { isSystemAdmin } from '$lib/server/workspaces';
import { writeAudit } from '$lib/server/audit';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { getSharedEngineHostState, saveSharedEngineHostState } from '$lib/server/engine-host-state';
import { engineHostProvisioningAvailable, provisionSharedEngineHost, refreshSharedEngineDeployment } from '$lib/server/vercel-engine-provision';
import { confirmSharedEngineHostLink, confirmSharedEngineHostUnlink, readSharedEngineHostLink } from '$lib/server/engine-host-remote';
import { getVercelConnectionSummary } from '$lib/server/vercel-connection';

const fail = (error:any) => json({error:String(error?.message||'Shared Engine Host request failed'),code:String(error?.code||'ENGINE_HOST_ERROR')},{status:Number(error?.status||500)});
const fatalLinkCodes = new Set(['INSTALLATION_MISMATCH','PANEL_URL_MISMATCH','ENGINE_HOST_ALREADY_LINKED','ENGINE_HOST_INSTALLATION_MISMATCH','ENGINE_HOST_DEPLOYMENT_MISMATCH']);

async function context(cookies:any) {
	const user=await requireUser(cookies);
	await assertPanelLicensed();
	if(!isSystemAdmin(user)) throw Object.assign(new Error('System Owner or Admin required'),{status:403});
	return user;
}

async function statusPayload(extra:Record<string,unknown>={}) {
	return {host:await getSharedEngineHostState(),provisioningAvailable:await engineHostProvisioningAvailable(),vercelConnection:await getVercelConnectionSummary(),provider:'vercel',...extra};
}

async function assertNoAttachedEngines() {
	const db=getSupabaseAdmin();
	const result=await db.from('orbitfs_addons').select('id,name').eq('attached',true).limit(20);
	if(result.error) throw result.error;
	if((result.data||[]).length) {
		const names=(result.data||[]).map((row:any)=>String(row.name||row.id)).join(', ');
		throw Object.assign(new Error(`Detach all engines before unlinking the Shared Engine Host: ${names}`),{status:409,code:'ENGINE_HOST_ENGINES_ATTACHED'});
	}
}

async function advanceProvisionedHost(user:any, body:Record<string,any>={}) {
	let current=await getSharedEngineHostState();
	let deployment:any=null;
	if(current.deploymentId && !['linked','ready'].includes(current.state)) {
		deployment=await refreshSharedEngineDeployment(body);
		current=deployment.host;
		if(!deployment.ready) return {waiting:true,phase:'deploying',readyState:deployment.readyState,remote:null};
	}
	if(!current.hostUrl) throw Object.assign(new Error('Deploy the Shared Engine Host before linking it.'),{status:409,code:'ENGINE_HOST_NOT_DEPLOYED'});

	if(['linked','ready'].includes(current.state)) {
		const remote=await readSharedEngineHostLink();
		await saveSharedEngineHostState({state:'ready',lastHealthAt:new Date().toISOString(),lastSyncAt:new Date().toISOString(),lastError:null});
		return {waiting:false,phase:'ready',readyState:deployment?.readyState||'READY',remote};
	}

	await saveSharedEngineHostState({state:'linking',lastError:null});
	try {
		const remote=await confirmSharedEngineHostLink({installationId:current.installationId,panelUrl:String(current.panelUrl||''),actorUserId:String(user.id)});
		await saveSharedEngineHostState({state:'ready',lastHealthAt:new Date().toISOString(),lastSyncAt:new Date().toISOString(),lastError:null});
		return {waiting:false,phase:'ready',readyState:deployment?.readyState||'READY',remote};
	} catch(error:any) {
		const code=String(error?.code||'');
		if(fatalLinkCodes.has(code)) {
			await saveSharedEngineHostState({state:'error',lastError:String(error?.message||'Shared Engine Host linking failed')}).catch(()=>undefined);
			throw error;
		}
		await saveSharedEngineHostState({state:'deployed',lastSyncAt:new Date().toISOString(),lastError:`Engine deployment is ready; waiting for Host startup: ${String(error?.message||'not reachable yet')}`});
		return {waiting:true,phase:'starting',readyState:deployment?.readyState||'READY',remote:null};
	}
}

export async function POST({params,request,cookies}:any) {
	try {
		const user=await context(cookies);
		const action=String(params.action||'').trim().toLowerCase();
		const body=await request.json().catch(()=>({}));

		if(action==='provision') {
			const provisioned=await provisionSharedEngineHost(body);
			const advanced=await advanceProvisionedHost(user,body);
			await writeAudit({actorUserId:user.id,action:'engine_host.provision',targetType:'engine_host',targetId:provisioned.projectId||provisioned.installationId,detail:{provider:'vercel',projectName:provisioned.projectName,hostUrl:provisioned.hostUrl,automaticLink:true,phase:advanced.phase}});
			return json({ok:true,...advanced,...await statusPayload()});
		}

		if(action==='link') {
			const advanced=await advanceProvisionedHost(user,body);
			if(!advanced.waiting) {
				const current=await getSharedEngineHostState();
				await writeAudit({actorUserId:user.id,action:'engine_host.link',targetType:'engine_host',targetId:current.installationId,detail:{hostUrl:current.hostUrl,remoteConfirmed:true,automatic:false}});
			}
			return json({ok:true,...advanced,...await statusPayload()});
		}

		if(action==='refresh') {
			const current=await getSharedEngineHostState();
			if(!current.hostUrl && !current.deploymentId) return json({ok:true,waiting:false,phase:'not_deployed',...await statusPayload()});
			const advanced=await advanceProvisionedHost(user,body);
			return json({ok:true,...advanced,...await statusPayload()});
		}

		if(action==='unlink') {
			await assertNoAttachedEngines();
			const current=await getSharedEngineHostState();
			if(current.hostUrl&&['linked','ready','error'].includes(current.state)) await confirmSharedEngineHostUnlink(current.installationId,String(user.id));
			const host=await saveSharedEngineHostState({state:current.hostUrl?'deployed':'not_deployed',linkedAt:null,linkedByUserId:null,lastSyncAt:new Date().toISOString(),lastError:null});
			await writeAudit({actorUserId:user.id,action:'engine_host.unlink',targetType:'engine_host',targetId:current.installationId,detail:{hostUrl:current.hostUrl}});
			return json({ok:true,host,provisioningAvailable:await engineHostProvisioningAvailable(),vercelConnection:await getVercelConnectionSummary(),provider:'vercel'});
		}

		throw Object.assign(new Error('Not found'),{status:404});
	} catch(error) {
		return fail(error);
	}
}
