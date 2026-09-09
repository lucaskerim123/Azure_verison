import { getSupabaseAdmin } from '$lib/server/supabase';
import { getKnowledgeArchitecture } from '$lib/server/knowledge-architecture';

const PRESETS=['low','medium','high','custom1','custom2'] as const;
export const APEX_MCP_WORKSPACE_BUNDLE='APEX · Active Workspace Knowledge';
export const APEX_MCP_PROJECT_BUNDLE_PREFIX='APEX · Active Project Knowledge · ';
const now=()=>new Date().toISOString();
const text=(value:unknown)=>String(value??'').trim();
const canonicalProvider=(provider:unknown)=>['library.native','memory.knowledge','base.profiles'].includes(text(provider));
const retiredLifecycle=(value:unknown)=>['old','deprecated','archived','archive','draft','superseded'].includes(text(value).toLowerCase());

export function isApexManagedMcpBundleName(value:unknown){
	const name=text(value);
	return name===APEX_MCP_WORKSPACE_BUNDLE||name.startsWith(APEX_MCP_PROJECT_BUNDLE_PREFIX);
}

function autoLoadable(entry:any){
	return String(entry?.usage||'primary')==='primary' && ['active','final'].includes(String(entry?.state||'active'));
}

async function mcpAvailable(){
	const db=getSupabaseAdmin();
	const result=await db.from('orbitfs_addons').select('id,installed').eq('id','mcp').maybeSingle();
	if(result.error)throw result.error;
	return result.data?.installed===true;
}

/**
 * Library is authoritative for whether Knowledge is still current. Knowledge
 * Architecture decides what should load; Library decides whether that target is
 * still a live canonical target. This prevents a stale architecture entry from
 * forcing old/deprecated/deleted Knowledge into MCP startup.
 */
async function loadableLibraryItemIds(workspaceId:string){
	const db=getSupabaseAdmin();
	const result=await db.from('orbitfs_library_state').select('state').eq('workspace_id',workspaceId).maybeSingle();
	if(result.error)throw result.error;
	const state:any=result.data?.state||{};
	const items=Array.isArray(state.items)?state.items:[];
	return new Set(items.filter((item:any)=>
		String(item?.status||'active')==='active' &&
		canonicalProvider(item?.source?.provider) &&
		!retiredLifecycle(item?.lifecycleState||item?.lifecycle)
	).map((item:any)=>String(item.id)));
}

async function ensureBundle(workspaceId:string,name:string,description:string){
	const db=getSupabaseAdmin();
	const existing=await db.from('mcp_context_bundles').select('id,name,version').eq('workspace_id',workspaceId).eq('name',name).maybeSingle();
	if(existing.error)throw existing.error;
	if(existing.data){
		const updated=await db.from('mcp_context_bundles').update({description,enabled:true,updated_at:now(),version:Number((existing.data as any).version||1)+1}).eq('id',existing.data.id);
		if(updated.error)throw updated.error;
		return String(existing.data.id);
	}
	const created=await db.from('mcp_context_bundles').insert({
		workspace_id:workspaceId,name,description,enabled:true,updated_at:now()
	}).select('id').single();
	if(created.error)throw created.error;
	return String(created.data.id);
}

async function replaceKnowledgeEntries(bundleId:string,entries:any[]){
	const db=getSupabaseAdmin();
	const [removedEntries,removedDeps]=await Promise.all([
		db.from('mcp_context_bundle_entries').delete().eq('bundle_id',bundleId),
		db.from('mcp_context_bundle_dependencies').delete().eq('bundle_id',bundleId)
	]);
	if(removedEntries.error)throw removedEntries.error;
	if(removedDeps.error)throw removedDeps.error;
	const rows=entries.filter(autoLoadable).sort((a:any,b:any)=>Number(b.priority||50)-Number(a.priority||50)).map((entry:any,index:number)=>({
		bundle_id:bundleId,
		entry_type:'knowledge',
		item_path:'',
		attachment_type:'knowledge',
		profile_id:null,
		profile_name:null,
		knowledge_item_id:String(entry.itemId),
		knowledge_item_name:String(entry.name||'Knowledge'),
		load_mode:'smart',
		recursive_flag:false,
		required_flag:false,
		priority:Math.max(0,100-Number(entry.priority||50)),
		sort_order:index
	}));
	if(rows.length){
		const inserted=await db.from('mcp_context_bundle_entries').insert(rows);
		if(inserted.error)throw inserted.error;
	}
	return rows.length;
}

async function ensureWorkspacePresetAssignments(workspaceId:string,bundleId:string){
	const db=getSupabaseAdmin();
	const existing=await db.from('mcp_workspace_preset_bundles').select('preset,bundle_id').eq('workspace_id',workspaceId).eq('bundle_id',bundleId);
	if(existing.error)throw existing.error;
	const assigned=new Set((existing.data||[]).map((row:any)=>String(row.preset)));
	const rows=PRESETS.filter((preset)=>!assigned.has(preset)).map((preset,index)=>({
		workspace_id:workspaceId,preset,bundle_id:bundleId,required_flag:false,sort_order:900+index
	}));
	if(rows.length){const inserted=await db.from('mcp_workspace_preset_bundles').insert(rows);if(inserted.error)throw inserted.error;}
}

async function ensureProjectAssignment(projectId:string,bundleId:string,sortOrder:number){
	const db=getSupabaseAdmin();
	const existing=await db.from('mcp_project_context_bundles').select('project_id,bundle_id').eq('project_id',projectId).eq('bundle_id',bundleId).limit(1).maybeSingle();
	if(existing.error)throw existing.error;
	if(existing.data)return;
	const inserted=await db.from('mcp_project_context_bundles').insert({project_id:projectId,bundle_id:bundleId,required_flag:false,sort_order:sortOrder});
	if(inserted.error)throw inserted.error;
}

async function removeObsoleteManagedBundles(workspaceId:string,keepNames:Set<string>){
	const db=getSupabaseAdmin();
	const result=await db.from('mcp_context_bundles').select('id,name').eq('workspace_id',workspaceId);
	if(result.error)throw result.error;
	const obsolete=(result.data||[]).filter((bundle:any)=>isApexManagedMcpBundleName(bundle.name)&&!keepNames.has(String(bundle.name)));
	for(const bundle of obsolete){
		const id=String(bundle.id);
		const [projectLinks,presetLinks,projectPresetLinks,entries,depsParent,depsChild]=await Promise.all([
			db.from('mcp_project_context_bundles').delete().eq('bundle_id',id),
			db.from('mcp_workspace_preset_bundles').delete().eq('bundle_id',id),
			db.from('mcp_project_preset_bundles').delete().eq('bundle_id',id),
			db.from('mcp_context_bundle_entries').delete().eq('bundle_id',id),
			db.from('mcp_context_bundle_dependencies').delete().eq('bundle_id',id),
			db.from('mcp_context_bundle_dependencies').delete().eq('depends_on_bundle_id',id)
		]);
		for(const response of [projectLinks,presetLinks,projectPresetLinks,entries,depsParent,depsChild])if(response.error)throw response.error;
		const removed=await db.from('mcp_context_bundles').delete().eq('id',id).eq('workspace_id',workspaceId);
		if(removed.error)throw removed.error;
	}
	return obsolete.length;
}

/**
 * Mirrors Knowledge Architecture's active/primary selection into MCP's existing
 * bundle loader. APEX does not create a second context-loading system: it keeps
 * system-managed CCS bundles in sync and MCP loads them through normal startup.
 * Reference-only/draft/superseded Knowledge remains searchable in Library but is
 * intentionally not force-loaded into startup context.
 */
export async function syncApexKnowledgeToMcp(workspaceId:string){
	if(!await mcpAvailable())return {available:false,reason:'mcp_not_installed'};
	const db=getSupabaseAdmin();
	const [architecture,liveLibraryIds]:[any,Set<string>]=await Promise.all([
		getKnowledgeArchitecture(workspaceId),
		loadableLibraryItemIds(workspaceId)
	]);
	if(architecture.setupComplete!==true){
		const removedManagedBundles=await removeObsoleteManagedBundles(workspaceId,new Set());
		return {available:true,synced:false,reason:'knowledge_setup_incomplete',removedManagedBundles};
	}

	const desiredNames=new Set<string>([APEX_MCP_WORKSPACE_BUNDLE]);
	const workspaceBundleId=await ensureBundle(
		workspaceId,
		APEX_MCP_WORKSPACE_BUNDLE,
		'System-managed by APEX + Knowledge Setup. Active primary workspace Knowledge is loaded by MCP through normal OSS/CCS startup.'
	);
	const workspaceConfigured=(architecture.globalItems||[]).filter(autoLoadable);
	const workspaceEntries=workspaceConfigured.filter((entry:any)=>liveLibraryIds.has(String(entry.itemId)));
	const workspaceLoaded=await replaceKnowledgeEntries(workspaceBundleId,workspaceEntries);
	await ensureWorkspacePresetAssignments(workspaceId,workspaceBundleId);

	const projectsResult=await db.from('mcp_projects').select('id,name').eq('workspace_id',workspaceId);
	if(projectsResult.error)throw projectsResult.error;
	const mcpProjects=projectsResult.data||[];
	for(const project of mcpProjects)await ensureProjectAssignment(String(project.id),workspaceBundleId,900);

	const projectBundles:any[]=[];
	let skippedLibraryItems=workspaceConfigured.length-workspaceEntries.length;
	for(const project of architecture.projects||[]){
		const mcpProject=mcpProjects.find((row:any)=>String(row.id)===String(project.id)||String(row.name||'').toLowerCase()===String(project.name||'').toLowerCase());
		if(!mcpProject)continue;
		const bundleName=`${APEX_MCP_PROJECT_BUNDLE_PREFIX}${String(project.name||project.id)}`;
		desiredNames.add(bundleName);
		const bundleId=await ensureBundle(
			workspaceId,
			bundleName,
			`System-managed by APEX + Knowledge Setup for MCP project ${String(project.name||project.id)}.`
		);
		const configured=(architecture.projectItems||[]).filter((entry:any)=>String(entry.projectId)===String(project.id)&&autoLoadable(entry));
		const entries=configured.filter((entry:any)=>liveLibraryIds.has(String(entry.itemId)));
		skippedLibraryItems+=configured.length-entries.length;
		const loaded=await replaceKnowledgeEntries(bundleId,entries);
		await ensureProjectAssignment(String(mcpProject.id),bundleId,901);
		projectBundles.push({projectId:String(mcpProject.id),bundleId,activeKnowledge:loaded,skippedLibraryItems:configured.length-entries.length});
	}

	const removedObsoleteBundles=await removeObsoleteManagedBundles(workspaceId,desiredNames);
	return {
		available:true,
		synced:true,
		architectureRevision:Number(architecture.revision||0),
		workspace:{bundleId:workspaceBundleId,activeKnowledge:workspaceLoaded,skippedLibraryItems:workspaceConfigured.length-workspaceEntries.length},
		projects:projectBundles,
		skippedLibraryItems,
		removedObsoleteBundles
	};
}

/** Reconcile all live workspaces when MCP/APEX attachment order changes. */
export async function syncAllApexKnowledgeToMcp(){
	if(!await mcpAvailable())return {available:false,reason:'mcp_not_installed',workspaces:[]};
	const db=getSupabaseAdmin();
	const result=await db.from('orbitfs_workspaces').select('id,name,status').neq('status','archived');
	if(result.error)throw result.error;
	const workspaces:any[]=[];
	for(const workspace of result.data||[]){
		try{
			workspaces.push({workspaceId:String(workspace.id),workspaceName:workspace.name,...await syncApexKnowledgeToMcp(String(workspace.id))});
		}catch(error:any){
			workspaces.push({workspaceId:String(workspace.id),workspaceName:workspace.name,synced:false,error:String(error?.message||error||'APEX/MCP reconciliation failed')});
		}
	}
	return {available:true,workspaces,synced:workspaces.filter((item)=>item.synced===true).length,failed:workspaces.filter((item)=>item.error).length};
}
