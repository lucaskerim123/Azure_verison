import type { OrbitUser } from '$lib/server/auth';
import { createLink, readLibrary } from '$lib/server/library';
import { getKnowledgeArchitecture, saveKnowledgeArchitecture } from '$lib/server/knowledge-architecture';
import { migrateMcpKnowledgeRevisionReferences } from '$lib/server/mcp-knowledge-sync';
import { syncApexKnowledgeToMcp } from '$lib/server/apex-mcp-integration';
import { syncApexLibraryProvenance } from '$lib/server/apex-library-integration';

function objectValue(value:unknown):Record<string,any>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};}

async function ensureApexRevisionLineage(user:OrbitUser,workspaceId:string,item:any,revisionOf:string,apex:any){
	if(!revisionOf||!item?.id||String(item.id)===revisionOf)return {linked:false};
	const state:any=await readLibrary(workspaceId);
	const exists=(state.links||[]).some((link:any)=>
		String(link.sourceItemId||link.fromItemId||'')===String(item.id)&&
		String(link.targetItemId||link.toItemId||'')===revisionOf&&
		['derived_from','revision_of'].includes(String(link.relation||link.type||''))
	);
	if(exists)return {linked:true,existing:true};
	const created=await createLink(user,workspaceId,{
		sourceItemId:String(item.id),
		targetItemId:revisionOf,
		relation:'derived_from',
		inverseRelation:'revised_by',
		metadata:{sourceSystem:'apex',kind:'revision',jobId:apex.jobId||null,revision:Number(apex.revision||0)||null}
	});
	return {linked:true,existing:false,linkId:created?.link?.id||null};
}

async function savePlacement(user:OrbitUser,workspaceId:string,item:any,route:any,importMode:string){
	const architecture:any=await getKnowledgeArchitecture(workspaceId);
	if(architecture.setupComplete!==true)return {synced:false,reason:'knowledge_setup_incomplete'};
	if(route.matched!==true||String(route.routing||'suggest')!=='automatic')return {synced:false,reason:'route_not_automatic'};
	const projectId=String(route.projectId||'').trim()||null;
	if(projectId && !(architecture.projects||[]).some((project:any)=>String(project.id)===projectId))return {synced:false,reason:'project_not_found'};
	const all=[...(architecture.globalItems||[]),...(architecture.projectItems||[])].filter((entry:any)=>String(entry.itemId)!==String(item.id));
	all.push({
		id:`${projectId?'project':'workspace'}:${item.id}`,
		itemId:String(item.id),
		name:String(item.name||'APEX Knowledge'),
		kind:'knowledge',
		category:String(item.category||route.category||route.label||''),
		provider:String(item.source?.provider||'library.native'),
		projectId,
		usage:importMode==='reference'?'reference':'primary',
		state:importMode==='draft'?'draft':'active',
		protection:'permission',
		scope:projectId?'project':'workspace',
		priority:projectId?75:65
	});
	const saved=await saveKnowledgeArchitecture(user,workspaceId,{
		...architecture,
		items:all,
		projects:architecture.projects||[],
		globalRoutes:architecture.globalRoutes||[],
		setupComplete:true
	});
	const mcpContextSync=await syncApexKnowledgeToMcp(workspaceId).catch((error:any)=>({
		available:false,synced:false,reason:'mcp_context_sync_failed',error:String(error?.message||error||'MCP context sync failed')
	}));
	return {synced:true,projectId,revision:Number(saved.architecture?.revision||0),mcpContextSync};
}

/**
 * When APEX resolves an exact duplicate or the user chooses "use existing",
 * route that canonical Library item without creating a second copy. The current
 * APEX job supplies the routing decision; the existing Library item remains the
 * authoritative content/source record.
 */
export async function syncApexExistingKnowledgeRoute(user:OrbitUser,workspaceId:string,itemId:string,job:any){
	const state:any=await readLibrary(workspaceId);
	const item=(state.items||[]).find((entry:any)=>String(entry.id)===String(itemId));
	if(!item)return {synced:false,reason:'knowledge_item_not_found'};
	const route=objectValue(job?.result?.routing?.knowledgeArchitectureRoute);
	const importMode=String(job?.importMode||'knowledge');
	const placement=await savePlacement(user,workspaceId,item,route,importMode);
	return {...placement,reusedExisting:true,knowledgeItemId:String(item.id)};
}

export async function syncApexKnowledgeRoute(user:OrbitUser,workspaceId:string,item:any){
	const apex=objectValue(item?.metadata?.apex);
	const routing=objectValue(apex.routing);
	const route=objectValue(routing.knowledgeArchitectureRoute);
	const revisionOf=String(apex.revisionOf||'').trim();
	if(!item?.id)return {synced:false,reason:'knowledge_item_required'};

	const libraryProvenance=await syncApexLibraryProvenance(user,workspaceId,item).catch((error:any)=>({
		synced:false,reason:'library_provenance_failed',error:String(error?.message||error||'APEX Library provenance sync failed')
	}));
	const libraryLineage=revisionOf
		?await ensureApexRevisionLineage(user,workspaceId,item,revisionOf,apex)
		:{linked:false};
	const mcpRevisionSync=revisionOf
		?await migrateMcpKnowledgeRevisionReferences(workspaceId,revisionOf,item)
		:{migrated:false,invalidatedActiveContexts:0};
	const architecture:any=await getKnowledgeArchitecture(workspaceId);
	if(architecture.setupComplete!==true)return {synced:false,reason:'knowledge_setup_incomplete',libraryProvenance,libraryLineage,mcpRevisionSync};
	const original=[...(architecture.globalItems||[]),...(architecture.projectItems||[])];
	const previousEntries=revisionOf?original.filter((entry:any)=>String(entry.itemId)===revisionOf):[];
	let all=original.filter((entry:any)=>String(entry.itemId)!==String(item.id)&&(!revisionOf||String(entry.itemId)!==revisionOf));
	const importMode=String(apex.importMode||'knowledge');
	const automatic=route.matched===true&&String(route.routing||'suggest')==='automatic';

	if(automatic){
		const projectId=String(route.projectId||'').trim()||null;
		if(projectId && !(architecture.projects||[]).some((project:any)=>String(project.id)===projectId))return {synced:false,reason:'project_not_found',libraryProvenance,libraryLineage,mcpRevisionSync};
		all.push({
			id:`${projectId?'project':'workspace'}:${item.id}`,
			itemId:String(item.id),
			name:String(item.name||'APEX Knowledge'),
			kind:'knowledge',
			category:String(item.category||route.category||route.label||''),
			provider:String(item.source?.provider||'library.native'),
			projectId,
			usage:importMode==='reference'?'reference':'primary',
			state:importMode==='draft'?'draft':'active',
			protection:'permission',
			scope:projectId?'project':'workspace',
			priority:projectId?75:65
		});
	} else if(previousEntries.length){
		// A revision inherits its existing Knowledge Architecture placement when
		// APEX did not produce a new automatic destination. This avoids leaving
		// MCP/project loading pinned to the retired Library revision.
		for(const previous of previousEntries){
			all.push({
				...previous,
				id:`${previous.projectId?'project':'workspace'}:${item.id}`,
				itemId:String(item.id),
				name:String(item.name||previous.name||'APEX Knowledge'),
				kind:'knowledge',
				category:String(item.category||previous.category||''),
				provider:String(item.source?.provider||previous.provider||'library.native'),
				usage:importMode==='reference'?'reference':previous.usage||'primary',
				state:importMode==='draft'?'draft':previous.state==='archive'||previous.state==='superseded'?'active':previous.state||'active'
			});
		}
	} else {
		return {synced:false,reason:'route_not_automatic',libraryProvenance,libraryLineage,mcpRevisionSync};
	}

	const saved=await saveKnowledgeArchitecture(user,workspaceId,{
		...architecture,
		items:all,
		projects:architecture.projects||[],
		globalRoutes:architecture.globalRoutes||[],
		setupComplete:true
	});
	const mcpContextSync=await syncApexKnowledgeToMcp(workspaceId).catch((error:any)=>({
		available:false,
		synced:false,
		reason:'mcp_context_sync_failed',
		error:String(error?.message||error||'MCP context sync failed')
	}));
	const currentEntry=all.find((entry:any)=>String(entry.itemId)===String(item.id));
	return {
		synced:true,
		projectId:currentEntry?.projectId||null,
		replacedItemId:revisionOf||null,
		inheritedRevisionRoute:!automatic&&previousEntries.length>0,
		libraryProvenance,
		libraryLineage,
		mcpRevisionSync,
		mcpContextSync,
		revision:Number(saved.architecture?.revision||0)
	};
}
