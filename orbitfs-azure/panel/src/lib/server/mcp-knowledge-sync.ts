import type { OrbitUser } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { getKnowledgeArchitecture, normalizeKnowledgeArchitecture } from '$lib/server/knowledge-architecture';
import { syncApexKnowledgeToMcp } from '$lib/server/apex-mcp-integration';

const clean=(value:unknown)=>String(value??'').trim();
const lower=(value:unknown)=>clean(value).toLowerCase();

async function saveArchitecture(workspaceId:string,user:OrbitUser,architecture:any){
	const db=getSupabaseAdmin();
	const result=await db.from('orbitfs_settings').upsert({
		scope_type:'workspace',scope_id:workspaceId,key:'knowledge_architecture',value:architecture,updated_at:new Date().toISOString()
	},{onConflict:'scope_type,scope_id,key'});
	if(result.error)throw result.error;
	return architecture;
}

export async function syncMcpProjectKnowledge(user:OrbitUser,workspaceId:string,project:any){
	const id=clean(project?.id),name=clean(project?.name);
	if(!id||!name)throw Object.assign(new Error('Project ID and name are required'),{status:400});
	const current:any=await getKnowledgeArchitecture(workspaceId);
	const projects=[...(current.projects||[])];
	const match=projects.find((entry:any)=>clean(entry.id)===id||lower(entry.name)===lower(name));
	const oldId=clean(match?.id);
	const nextProject={
		id,name,description:clean(project?.description||match?.description),scope:match?.scope==='shared'?'shared':'project',routes:Array.isArray(match?.routes)?match.routes:[]
	};
	const nextProjects=match?projects.map((entry:any)=>entry===match?nextProject:entry):[...projects,nextProject];
	const items=[...(current.globalItems||[]),...(current.projectItems||[])].map((item:any)=>oldId&&oldId!==id&&clean(item.projectId)===oldId?{...item,projectId:id,scope:'project'}:item);
	const normalized=normalizeKnowledgeArchitecture(workspaceId,{setupComplete:current.setupComplete,items,projects:nextProjects,globalRoutes:current.globalRoutes||[]},current,user.username||user.id);
	await saveArchitecture(workspaceId,user,normalized);
	const mcpContextSync=await syncApexKnowledgeToMcp(workspaceId).catch((error:any)=>({synced:false,error:String(error?.message||error||'APEX/MCP project reconciliation failed')}));
	return {project:nextProject,revision:normalized.revision,migratedFrom:oldId&&oldId!==id?oldId:null,mcpContextSync};
}

export async function removeMcpProjectKnowledge(user:OrbitUser,workspaceId:string,input:any){
	const id=clean(input?.projectId||input?.id),name=clean(input?.name);
	if(!id&&!name)throw Object.assign(new Error('Project ID or name is required'),{status:400});
	const current:any=await getKnowledgeArchitecture(workspaceId);
	const match=(current.projects||[]).find((entry:any)=>(id&&clean(entry.id)===id)||(name&&lower(entry.name)===lower(name)));
	if(!match)return {removed:false,revision:Number(current.revision||0),mcpContextSync:await syncApexKnowledgeToMcp(workspaceId).catch(()=>({synced:false}))};
	const matchId=clean(match.id);
	const projects=(current.projects||[]).filter((entry:any)=>entry!==match);
	const items=[...(current.globalItems||[]),...(current.projectItems||[])].map((item:any)=>clean(item.projectId)===matchId?{...item,projectId:null,scope:'workspace'}:item);
	const normalized=normalizeKnowledgeArchitecture(workspaceId,{setupComplete:current.setupComplete,items,projects,globalRoutes:current.globalRoutes||[]},current,user.username||user.id);
	await saveArchitecture(workspaceId,user,normalized);
	const mcpContextSync=await syncApexKnowledgeToMcp(workspaceId).catch((error:any)=>({synced:false,error:String(error?.message||error||'APEX/MCP project reconciliation failed')}));
	return {removed:true,revision:normalized.revision,knowledgeMovedToWorkspace:items.filter((item:any)=>!item.projectId).length,mcpContextSync};
}

/** Keep explicit MCP context-bundle attachments pointed at the current Library revision. */
export async function migrateMcpKnowledgeRevisionReferences(workspaceId:string,previousItemId:string,nextItem:any){
	const oldId=clean(previousItemId),nextId=clean(nextItem?.id);
	if(!oldId||!nextId||oldId===nextId)return {migrated:false,invalidatedActiveContexts:0};
	const db=getSupabaseAdmin();
	const update=await db.from('mcp_context_bundle_entries').update({
		knowledge_item_id:nextId,
		knowledge_item_name:clean(nextItem?.name)||null
	}).eq('knowledge_item_id',oldId);
	if(update.error)throw update.error;

	// Active receipts contain a content snapshot. Invalidate only receipts which
	// loaded the superseded revision so MCP cannot keep serving stale Knowledge.
	const active=await db.from('mcp_active_contexts').select('user_id,client_id,workspace_id,context_key,receipt').eq('workspace_id',workspaceId);
	if(active.error)throw active.error;
	let invalidated=0;
	for(const row of active.data||[]){
		const files=Array.isArray((row as any).receipt?.files)?(row as any).receipt.files:[];
		if(!files.some((item:any)=>clean(item?.knowledgeItemId)===oldId))continue;
		const removed=await db.from('mcp_active_contexts').delete()
			.eq('user_id',(row as any).user_id)
			.eq('client_id',(row as any).client_id)
			.eq('workspace_id',(row as any).workspace_id)
			.eq('context_key',(row as any).context_key);
		if(removed.error)throw removed.error;
		invalidated++;
	}
	return {migrated:true,previousItemId:oldId,nextItemId:nextId,invalidatedActiveContexts:invalidated};
}
