import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertMcpLicensed } from '$lib/server/mcp-cloud';
import { requireMcpWorkspace } from '$lib/server/mcp-workspace-state';
import { removeMcpProjectKnowledge, syncMcpProjectKnowledge } from '$lib/server/mcp-knowledge-sync';

export async function POST({cookies,params,request}:any){
	try{
		const user=await requireUser(cookies);
		await assertMcpLicensed();
		const workspaceId=String(params.workspaceId||'').trim();
		await requireMcpWorkspace(user,workspaceId,'manage_mcp_projects');
		const body=await request.json().catch(()=>({}));
		if(body.action==='delete')return json(await removeMcpProjectKnowledge(user,workspaceId,body));
		return json(await syncMcpProjectKnowledge(user,workspaceId,body.project||body));
	}catch(error:any){
		return json({error:String(error?.message||'Knowledge project sync failed')},{status:Number(error?.status||500)});
	}
}
