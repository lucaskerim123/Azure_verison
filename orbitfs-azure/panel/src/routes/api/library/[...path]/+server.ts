import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { syncApexKnowledgeToMcp } from '$lib/server/apex-mcp-integration';
import {
	createCollection, createEvent, createLibraryItem, createLink, deleteCollection, deleteEvent,
	deleteLibraryItem, deleteLink, exportLibrary, importLibrary, indexLibraryItem, presentLibrary,
	readLibrary, retrieveLibrary, saveLibrary, saveUsage, deleteUsage,
	updateCollection, updateEvent, updateLibraryItem, createLibraryChangeRequest, listLibraryChangeRequests, assignLibraryChangeRequestTargets, resolveLibraryChangeRequest, createLibraryGroup, updateLibraryGroup, deleteLibraryGroup, resolveLibraryRoleTargets, libraryHealth, editLibraryChangeRequestOperation, createAppliedChangeRevision, getLibrarySettings, updateLibrarySettings
} from '$lib/server/library';

const clean=(v:any)=>String(v??'').trim();
function fail(error:any){return json({error:String(error?.message||'Request failed'),code:String(error?.code||'REQUEST_FAILED')},{status:Number(error?.status||500)});}
async function body(request:Request){return request.headers.get('content-type')?.includes('application/json') ? await request.json() : {};}
async function ctx(cookies:any){const user=await requireUser(cookies);await assertPanelLicensed();return user;}
function route(params:any){const p=clean(params.path).split('/').filter(Boolean);if(p[0]!=='workspaces'||!p[1])throw Object.assign(new Error('Library route not found'),{status:404});return {workspaceId:p[1],area:p[2]||'',id:p[3]||'',operation:p[4]||'',extra:p[5]||''};}
async function reconcileMcpKnowledge(workspaceId:string){
	return syncApexKnowledgeToMcp(workspaceId).catch((error:any)=>({available:false,synced:false,reason:'mcp_context_sync_failed',error:String(error?.message||error||'MCP context sync failed')}));
}
function withMcpSync(result:any,mcpContextSync:any){
	return result&&typeof result==='object'&&!Array.isArray(result)?{...result,mcpContextSync}:{result,mcpContextSync};
}
export async function GET({params,url,cookies}:any){
	try{const user=await ctx(cookies);const r=route(params);if(!r.area)return json(await presentLibrary(user,r.workspaceId));
		if(r.area==='export')return json(await exportLibrary(r.workspaceId));
		if(r.area==='providers')return json({providers:[{id:'library.native',name:'Native Library / Knowledge'},{id:'base.profiles',name:'Profiles'},{id:'memory.knowledge',name:'Memory / Knowledge Base'}],legacyProviders:[{id:'base.files',name:'Legacy file source',deprecated:true}]});
		if(r.area==='settings')return json(await getLibrarySettings(user,r.workspaceId));
		if(r.area==='targets')return json(await resolveLibraryRoleTargets(user,r.workspaceId,url.searchParams.get('role')||'general_record_target'));
		if(r.area==='health')return json(await libraryHealth(user,r.workspaceId));
		if(r.area==='change-requests')return json(await listLibraryChangeRequests(user,r.workspaceId,Object.fromEntries(url.searchParams.entries())));
		if(r.area==='changes'){const s=await readLibrary(r.workspaceId);return json({changes:[...(s.sourceHistory||[])].reverse(),count:(s.sourceHistory||[]).length});}
		if(r.area==='intelligence'){const s=await readLibrary(r.workspaceId);return json({workspaceId:r.workspaceId,entities:s.entities||[],entityMentions:s.entityMentions||[],facts:s.facts||[],factRelations:s.factRelations||[],stats:{facts:(s.facts||[]).length,relations:(s.factRelations||[]).length}});}
		if(r.area==='items'&&r.id&&r.operation==='resolve'){const s=await readLibrary(r.workspaceId);const item=s.items.find((x:any)=>x.id===r.id);if(!item)throw Object.assign(new Error('Knowledge item not found'),{status:404});return json({item});}
		if(r.area==='items'&&r.id&&r.operation==='sections'&&!r.extra){const s=await readLibrary(r.workspaceId);return json({itemId:r.id,sections:s.sections.filter((x:any)=>x.itemId===r.id),events:s.events.filter((x:any)=>x.itemId===r.id),entityMentions:(s.entityMentions||[]).filter((x:any)=>x.itemId===r.id),entities:s.entities||[],facts:(s.facts||[]).filter((x:any)=>x.itemId===r.id),factRelations:(s.factRelations||[]).filter((x:any)=>x.sourceItemId===r.id||x.targetItemId===r.id),changes:(s.sourceHistory||[]).filter((x:any)=>x.itemId===r.id).slice(-100)});}
		if(r.area==='items'&&r.id&&r.operation==='sections'&&r.extra){const s=await readLibrary(r.workspaceId);const section=s.sections.find((x:any)=>x.itemId===r.id&&x.id===r.extra);if(!section)throw Object.assign(new Error('Knowledge section not found'),{status:404});return json({section,content:section.content||section.preview||''});}
		if(r.area==='items'&&r.id&&r.operation==='lineage'){const s=await readLibrary(r.workspaceId);const item=s.items.find((x:any)=>x.id===r.id);return json({item,lineage:item?.lineage||{},parents:item?.lineage?.parents||[],children:s.items.filter((x:any)=>(x.lineage?.parents||[]).includes(r.id))});}
		if(r.area==='items'&&r.id&&r.operation==='impact'){const s=await readLibrary(r.workspaceId);return json({item:s.items.find((x:any)=>x.id===r.id),collections:s.collections.filter((c:any)=>(c.entries||[]).some((e:any)=>e.itemId===r.id)),usage:s.usage.filter((u:any)=>u.itemId===r.id),linkedItems:s.links.filter((l:any)=>l.sourceItemId===r.id||l.targetItemId===r.id)});}
		throw Object.assign(new Error('Library route not found'),{status:404});}catch(error){return fail(error);}}
export async function POST({params,request,cookies}:any){
	try{const user=await ctx(cookies);const r=route(params);const input=await body(request);
		if(r.area==='groups'&&!r.id)return json(await createLibraryGroup(user,r.workspaceId,input));
		if(r.area==='change-requests'&&!r.id)return json(await createLibraryChangeRequest(user,r.workspaceId,input));
		if(r.area==='change-requests'&&r.id&&r.operation==='revision'){
			const request=await createAppliedChangeRevision(user,r.workspaceId,r.id,input);
			return json({request,mcpContextSync:await reconcileMcpKnowledge(r.workspaceId)});
		}
		if(r.area==='import'){
			const result=await importLibrary(user,r.workspaceId,input);
			return json(withMcpSync(result,await reconcileMcpKnowledge(r.workspaceId)));
		}
		if(r.area==='scan')return json({deprecated:true,filesystem:false,message:'Filesystem scanning is retired in OrbitFS Cloud. Ingest content into Library/Memory instead.'},{status:410});
		if(r.area==='scan-register')return json({deprecated:true,filesystem:false,message:'Filesystem registration is retired in OrbitFS Cloud. Create or import Library knowledge instead.'},{status:410});
		if(r.area==='items'&&!r.id)return json(await createLibraryItem(user,r.workspaceId,input));
		if(r.area==='items'&&r.id&&r.operation==='index')return json(await indexLibraryItem(user,r.workspaceId,r.id));
		if(r.area==='retrieve')return json(await retrieveLibrary(user,r.workspaceId,input));
		if(r.area==='collections'&&!r.id)return json(await createCollection(user,r.workspaceId,input));
		if(r.area==='links'&&!r.id)return json(await createLink(user,r.workspaceId,input));
		if(r.area==='events'&&!r.id)return json(await createEvent(user,r.workspaceId,input));
		if(r.area==='usage'&&!r.id)return json(await saveUsage(user,r.workspaceId,input));
		if(r.area==='index-all'){const state=await readLibrary(r.workspaceId);const results:any[]=[];const failures:any[]=[];for(const item of state.items){if(['library.native','memory.knowledge'].includes(item.source?.provider))try{results.push(await indexLibraryItem(user,r.workspaceId,item.id));}catch(error:any){failures.push({itemId:item.id,error:String(error?.message||error)});}}return json({indexed:results.length,failed:failures.length,results,failures});}
		if(r.area==='items'&&r.id&&r.operation==='lineage'){const s=await readLibrary(r.workspaceId);const item=s.items.find((x:any)=>x.id===r.id);if(!item)throw Object.assign(new Error('Knowledge item not found'),{status:404});item.lineage=input;await saveLibrary(r.workspaceId,s);return json({item,lineage:item.lineage});}
		throw Object.assign(new Error('Library route not found'),{status:404});}catch(error){return fail(error);}}
export async function PATCH({params,request,cookies}:any){
	try{const user=await ctx(cookies);const r=route(params);const input=await body(request);
		if(r.area==='settings')return json(await updateLibrarySettings(user,r.workspaceId,input));
		if(r.area==='groups'&&r.id)return json(await updateLibraryGroup(user,r.workspaceId,r.id,input));
		if(r.area==='change-requests'&&r.id&&r.operation==='targets')return json({request:await assignLibraryChangeRequestTargets(user,r.workspaceId,r.id,input)});
		if(r.area==='change-requests'&&r.id&&r.operation==='operations')return json({request:await editLibraryChangeRequestOperation(user,r.workspaceId,r.id,input)});
		if(r.area==='change-requests'&&r.id&&!r.operation){
			const result=await resolveLibraryChangeRequest(user,r.workspaceId,r.id,input);
			return json(withMcpSync(result,await reconcileMcpKnowledge(r.workspaceId)));
		}
		if(r.area==='items'&&r.id){
			const result=await updateLibraryItem(user,r.workspaceId,r.id,input);
			return json(withMcpSync(result,await reconcileMcpKnowledge(r.workspaceId)));
		}
		if(r.area==='collections'&&r.id)return json(await updateCollection(user,r.workspaceId,r.id,input));
		if(r.area==='events'&&r.id)return json(await updateEvent(user,r.workspaceId,r.id,input));
		if(r.area==='facts'&&r.id){const s=await readLibrary(r.workspaceId);const fact=s.facts.find((x:any)=>x.id===r.id);if(!fact)throw Object.assign(new Error('Knowledge fact candidate not found'),{status:404});Object.assign(fact,input,{updatedAt:new Date().toISOString(),updatedBy:user.username});await saveLibrary(r.workspaceId,s);return json({fact});}
		if(r.area==='fact-relations'&&r.id){const s=await readLibrary(r.workspaceId);const relation=s.factRelations.find((x:any)=>x.id===r.id);if(!relation)throw Object.assign(new Error('Knowledge fact relationship not found'),{status:404});Object.assign(relation,input,{updatedAt:new Date().toISOString(),updatedBy:user.username});await saveLibrary(r.workspaceId,s);return json({relation});}
		if(r.area==='auto-links'&&r.id){const s=await readLibrary(r.workspaceId);const link=s.autoLinks.find((x:any)=>x.id===r.id);if(!link)throw Object.assign(new Error('Automatic knowledge link not found'),{status:404});Object.assign(link,input,{updatedAt:new Date().toISOString(),updatedBy:user.username});await saveLibrary(r.workspaceId,s);return json({link});}
		throw Object.assign(new Error('Library route not found'),{status:404});}catch(error){return fail(error);}}

export async function DELETE({params,url,cookies}:any){
	try{const user=await ctx(cookies);const r=route(params);
		if(r.area==='groups'&&r.id)return json(await deleteLibraryGroup(user,r.workspaceId,r.id));
		if(r.area==='items'&&r.id){
			const result=await deleteLibraryItem(user,r.workspaceId,r.id,url.searchParams.get('force')==='true');
			return json(withMcpSync(result,await reconcileMcpKnowledge(r.workspaceId)));
		}
		if(r.area==='collections'&&r.id)return json(await deleteCollection(user,r.workspaceId,r.id));
		if(r.area==='links'&&r.id)return json(await deleteLink(user,r.workspaceId,r.id));
		if(r.area==='events'&&r.id)return json(await deleteEvent(user,r.workspaceId,r.id));
		if(r.area==='usage'&&r.id)return json(await deleteUsage(user,r.workspaceId,r.id));
		throw Object.assign(new Error('Library route not found'),{status:404});}catch(error){return fail(error);}}
