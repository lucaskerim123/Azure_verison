import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getWorkspace, requireWorkspaceAccess } from '$lib/server/workspaces';
import { getKnowledgeArchitecture, saveKnowledgeArchitecture } from '$lib/server/knowledge-architecture';
import { syncApexKnowledgeToMcp } from '$lib/server/apex-mcp-integration';

const fail=(error:any)=>json({error:String(error?.message||'Knowledge Architecture request failed'),code:String(error?.code||'KNOWLEDGE_ARCHITECTURE_ERROR')},{status:Number(error?.status||500)});

export async function GET({params,cookies}:any){
	try{
		const user=await requireUser(cookies); await assertPanelLicensed();
		const workspace=await getWorkspace(String(params.workspaceId||'')); await requireWorkspaceAccess(user,workspace);
		return json({architecture:await getKnowledgeArchitecture(workspace.id)});
	}catch(error){return fail(error);}
}

export async function PUT({params,request,cookies}:any){
	try{
		const user=await requireUser(cookies); await assertPanelLicensed();
		const workspace=await getWorkspace(String(params.workspaceId||'')); await requireWorkspaceAccess(user,workspace);
		const result=await saveKnowledgeArchitecture(user,workspace.id,await request.json().catch(()=>({})));
		// Knowledge Setup remains authoritative even when MCP is absent/unavailable.
		// Rebuild the system-managed OSS/CCS Knowledge bundles immediately so
		// active/reference/project/priority changes affect the next MCP startup.
		const mcpContextSync=await syncApexKnowledgeToMcp(workspace.id).catch((error:any)=>({
			available:false,
			synced:false,
			reason:'mcp_context_sync_failed',
			error:String(error?.message||error||'MCP context sync failed')
		}));
		return json({ok:true,...result,mcpContextSync});
	}catch(error){return fail(error);}
}
