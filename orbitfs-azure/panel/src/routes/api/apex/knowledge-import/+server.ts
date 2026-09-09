import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import {
	completeApexKnowledgeUpload,
	getApexKnowledgeImportJob,
	prepareApexKnowledgeUpload,
	reviewApexKnowledgeImport
} from '$lib/server/apex-knowledge-ingest';
import { syncApexExistingKnowledgeRoute, syncApexKnowledgeRoute } from '$lib/server/apex-knowledge-routing';

function errorResponse(error:any) {
	return json({
		error:String(error?.message||'APEX Knowledge import failed'),
		code:String(error?.code||'APEX_KNOWLEDGE_IMPORT_FAILED')
	},{status:Number(error?.status||500)});
}

async function readJson(request:Request) {
	if(!request.headers.get('content-type')?.includes('application/json')) {
		throw Object.assign(new Error('APEX Knowledge import API accepts JSON only'),{status:415,code:'JSON_REQUIRED'});
	}
	return request.json().catch(()=>({}));
}

async function applyAutomaticRoute(user:any,workspaceId:string,result:any) {
	let routeSync:any=null;
	if(result?.knowledge?.id) {
		routeSync=await syncApexKnowledgeRoute(user,workspaceId,result.knowledge).catch((error:any)=>({
			synced:false,
			reason:'route_sync_failed',
			error:String(error?.message||error||'Knowledge route sync failed')
		}));
	} else {
		const existingId=String(result?.knowledgeItemId||result?.existingKnowledgeItemId||'').trim();
		const jobId=String(result?.jobId||'').trim();
		if(existingId&&jobId) {
			const job=await getApexKnowledgeImportJob(user,workspaceId,jobId).catch(()=>null);
			if(job) routeSync=await syncApexExistingKnowledgeRoute(user,workspaceId,existingId,job).catch((error:any)=>({
				synced:false,
				reason:'existing_route_sync_failed',
				error:String(error?.message||error||'Existing Knowledge route sync failed')
			}));
		}
	}
	return routeSync?{...result,routeSync}:result;
}

export async function POST({request,cookies}:any) {
	try {
		const user=await requireUser(cookies);
		const body=await readJson(request);
		const action=String(body.action||'prepare').toLowerCase();
		const workspaceId=String(body.workspaceId||'').trim();
		if(!workspaceId) return json({error:'workspaceId is required',code:'WORKSPACE_REQUIRED'},{status:400});
		if(action==='prepare') return json(await prepareApexKnowledgeUpload(user,workspaceId,body),{headers:{'cache-control':'no-store'}});
		if(action==='complete') {
			const uploadId=String(body.uploadId||'').trim();
			if(!uploadId) return json({error:'uploadId is required',code:'APEX_UPLOAD_REQUIRED'},{status:400});
			const result=await completeApexKnowledgeUpload(user,workspaceId,uploadId);
			return json(await applyAutomaticRoute(user,workspaceId,result),{headers:{'cache-control':'no-store'}});
		}
		return json({error:'action must be prepare or complete',code:'APEX_IMPORT_ACTION_INVALID'},{status:400});
	} catch(error) { return errorResponse(error); }
}

export async function PATCH({request,cookies}:any) {
	try {
		const user=await requireUser(cookies);
		const body=await readJson(request);
		const workspaceId=String(body.workspaceId||'').trim();
		const jobId=String(body.jobId||'').trim();
		const action=String(body.action||'').trim() as 'create_new'|'revision'|'use_existing';
		if(!workspaceId||!jobId) return json({error:'workspaceId and jobId are required',code:'APEX_REVIEW_INPUT_REQUIRED'},{status:400});
		if(!['create_new','revision','use_existing'].includes(action)) return json({error:'action must be create_new, revision or use_existing',code:'APEX_REVIEW_ACTION_INVALID'},{status:400});
		const result=await reviewApexKnowledgeImport(user,workspaceId,jobId,action);
		return json(await applyAutomaticRoute(user,workspaceId,result),{headers:{'cache-control':'no-store'}});
	} catch(error) { return errorResponse(error); }
}

export async function GET({url,cookies}:any) {
	try {
		const user=await requireUser(cookies);
		const workspaceId=String(url.searchParams.get('workspaceId')||'').trim();
		const jobId=String(url.searchParams.get('jobId')||'').trim();
		if(!workspaceId||!jobId) return json({error:'workspaceId and jobId are required',code:'APEX_JOB_INPUT_REQUIRED'},{status:400});
		return json(await getApexKnowledgeImportJob(user,workspaceId,jobId),{headers:{'cache-control':'no-store'}});
	} catch(error) { return errorResponse(error); }
}
