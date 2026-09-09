import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertMcpLicensed } from '$lib/server/mcp-cloud';
import { deleteMcpProject, requireMcpWorkspace, saveMcpProject } from '$lib/server/mcp-workspace-state';
import { removeMcpProjectKnowledge, syncMcpProjectKnowledge } from '$lib/server/mcp-knowledge-sync';
import { writeAudit } from '$lib/server/audit';

function fail(error:any){return json({error:String(error?.message||'MCP project request failed')},{status:Number(error?.status||500)});}

export async function PUT({cookies,params,request}:any){
	try{
		const user=await requireUser(cookies);await assertMcpLicensed();
		const workspaceId=String(params.workspaceId||''),projectId=String(params.projectId||'');
		await requireMcpWorkspace(user,workspaceId,'manage_mcp_projects');
		const body=await request.json().catch(()=>({}));
		const project=await saveMcpProject(workspaceId,user,body,projectId);
		const knowledge=await syncMcpProjectKnowledge(user,workspaceId,project);
		await writeAudit({actorUserId:user.id,workspaceId,action:'mcp.project.updated',targetType:'project',targetId:projectId,detail:{name:project?.name,knowledgeRevision:knowledge.revision}});
		return json({project,knowledge});
	}catch(error:any){return fail(error);}
}

export async function DELETE({cookies,params}:any){
	try{
		const user=await requireUser(cookies);await assertMcpLicensed();
		const workspaceId=String(params.workspaceId||''),projectId=String(params.projectId||'');
		await requireMcpWorkspace(user,workspaceId,'manage_mcp_projects');
		const knowledge=await removeMcpProjectKnowledge(user,workspaceId,{projectId});
		await deleteMcpProject(workspaceId,projectId);
		await writeAudit({actorUserId:user.id,workspaceId,action:'mcp.project.deleted',targetType:'project',targetId:projectId,detail:{knowledgeRevision:knowledge.revision,knowledgeMovedToWorkspace:knowledge.knowledgeMovedToWorkspace||0}});
		return json({deleted:true,knowledge});
	}catch(error:any){return fail(error);}
}
