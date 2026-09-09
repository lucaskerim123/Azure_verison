import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getWorkspace, requireWorkspaceAccess } from '$lib/server/workspaces';
import { knowledgeArchitectureHealth, knowledgeContextPlan, resolveKnowledgeRoute } from '$lib/server/knowledge-architecture';

const fail=(error:any)=>json({error:String(error?.message||'Knowledge Architecture request failed'),code:String(error?.code||'KNOWLEDGE_ARCHITECTURE_ERROR')},{status:Number(error?.status||500)});

export async function GET({params,cookies}:any){
	try{
		const user=await requireUser(cookies); await assertPanelLicensed();
		const workspace=await getWorkspace(String(params.workspaceId||'')); await requireWorkspaceAccess(user,workspace);
		if(params.action==='health') return json(await knowledgeArchitectureHealth(user,workspace.id));
		return json({error:'Not found'},{status:404});
	}catch(error){return fail(error);}
}

export async function POST({params,request,cookies}:any){
	try{
		const user=await requireUser(cookies); await assertPanelLicensed();
		const workspace=await getWorkspace(String(params.workspaceId||'')); await requireWorkspaceAccess(user,workspace);
		const body=await request.json().catch(()=>({}));
		if(params.action==='resolve-route') return json(await resolveKnowledgeRoute(workspace.id,body));
		if(params.action==='context-plan') return json(await knowledgeContextPlan(workspace.id,body));
		return json({error:'Not found'},{status:404});
	}catch(error){return fail(error);}
}
