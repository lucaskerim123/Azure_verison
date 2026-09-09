import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertMcpLicensed } from '$lib/server/mcp-cloud';
import { listMcpProjects, requireMcpWorkspace, saveMcpProject } from '$lib/server/mcp-workspace-state';
import { syncMcpProjectKnowledge } from '$lib/server/mcp-knowledge-sync';
import { writeAudit } from '$lib/server/audit';

function fail(error:any){return json({error:String(error?.message||'MCP project request failed')},{status:Number(error?.status||500)});}

export async function GET({cookies,params}:any){
	try{
		const user=await requireUser(cookies);await assertMcpLicensed();
		const workspaceId=String(params.workspaceId||'');await requireMcpWorkspace(user,workspaceId);
		return json({projects:await listMcpProjects(workspaceId)});
	}catch(error:any){return fail(error);}
}

export async function POST({cookies,params,request}:any){
	try{
		const user=await requireUser(cookies);await assertMcpLicensed();
		const workspaceId=String(params.workspaceId||'');await requireMcpWorkspace(user,workspaceId,'manage_mcp_projects');
		const body=await request.json().catch(()=>({}));
		const project=await saveMcpProject(workspaceId,user,body);
		const knowledge=await syncMcpProjectKnowledge(user,workspaceId,project);
		await writeAudit({actorUserId:user.id,workspaceId,action:'mcp.project.created',targetType:'project',targetId:project?.id,detail:{name:project?.name,knowledgeRevision:knowledge.revision}});
		return json({project,knowledge});
	}catch(error:any){return fail(error);}
}
