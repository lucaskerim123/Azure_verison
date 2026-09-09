import { indexLibraryItem, readLibrary, saveLibrary } from '$lib/server/library';
import type { OrbitUser } from '$lib/server/auth';

const text=(value:unknown)=>String(value??'').trim();
const key=(value:unknown)=>text(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const objectValue=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};

function overlaps(aStart:number,aEnd:number,bStart:number,bEnd:number){
	return Math.max(aStart,bStart)<Math.min(aEnd,bEnd);
}

/**
 * Library owns the canonical Knowledge text/index. APEX's extraction map is
 * projected onto those indexed sections as provenance only; it never replaces
 * Library indexing or creates a second search store.
 */
export async function syncApexLibraryProvenance(user:OrbitUser,workspaceId:string,item:any){
	const itemId=text(item?.id);
	const apex=objectValue(item?.metadata?.apex);
	const sourceMap=objectValue(apex.sourceMap);
	const apexSections=Array.isArray(sourceMap.sections)?sourceMap.sections:[];
	const apexChunks=Array.isArray(sourceMap.chunks)?sourceMap.chunks:[];
	if(!itemId||(!apexSections.length&&!apexChunks.length))return {synced:false,reason:'apex_source_map_unavailable'};

	let state:any=await readLibrary(workspaceId);
	let canonical=state.items.find((entry:any)=>String(entry.id)===itemId);
	if(!canonical)return {synced:false,reason:'library_item_not_found'};
	let sections=(state.sections||[]).filter((section:any)=>String(section.itemId)===itemId);
	let indexAttempted=false,indexError:string|null=null;

	// createLibraryItem normally indexes immediately. If that indexing failed,
	// retry through Library's own indexer rather than pretending APEX has a
	// separate index. Respect the workspace setting when automatic indexing is
	// intentionally disabled.
	if(!sections.length && state.settings?.autoIndexKnowledge!==false && ['library.native','memory.knowledge'].includes(String(canonical.source?.provider||''))){
		indexAttempted=true;
		try{
			await indexLibraryItem(user,workspaceId,itemId);
			state=await readLibrary(workspaceId);
			canonical=state.items.find((entry:any)=>String(entry.id)===itemId);
			sections=(state.sections||[]).filter((section:any)=>String(section.itemId)===itemId);
		}catch(error:any){
			indexError=String(error?.message||error||'Library indexing failed');
		}
	}

	if(!canonical)return {synced:false,reason:'library_item_not_found_after_index'};
	const used=new Set<number>();
	let enriched=0;

	for(let index=0;index<sections.length;index++){
		const section=sections[index];
		const titleKey=key(section.title||section.heading);
		let sourceIndex=apexSections.findIndex((candidate:any,candidateIndex:number)=>!used.has(candidateIndex)&&key(candidate.heading)===titleKey);
		if(sourceIndex<0&&index<apexSections.length&&!used.has(index))sourceIndex=index;
		const source=sourceIndex>=0?apexSections[sourceIndex]:null;
		if(sourceIndex>=0)used.add(sourceIndex);
		const start=Number(source?.startChar??-1),end=Number(source?.endChar??-1);
		const chunkIds=source
			?apexChunks.filter((chunk:any)=>overlaps(start,end,Number(chunk.startChar??-1),Number(chunk.endChar??-1))).map((chunk:any)=>String(chunk.id)).filter(Boolean)
			:[];
		section.apex={
			...(objectValue(section.apex)),
			jobId:apex.jobId||null,
			processor:apex.processor||null,
			processingVersion:apex.processingVersion||null,
			sourceAssetId:apex.sourceAssetId||null,
			sourceFilename:apex.sourceFilename||null,
			sourceMimeType:apex.sourceMimeType||null,
			sourceHash:apex.sourceHash||null,
			normalizedHash:apex.normalizedHash||null,
			revision:Number(apex.revision||1),
			revisionOf:apex.revisionOf||null,
			apexSectionId:source?.id||null,
			startChar:source?.startChar??null,
			endChar:source?.endChar??null,
			pageStart:source?.pageStart??null,
			pageEnd:source?.pageEnd??null,
			chunkIds
		};
		enriched++;
	}

	const indexed=sections.length>0;
	canonical.metadata={
		...(canonical.metadata||{}),
		apex:{
			...apex,
			libraryIntegration:{
				indexed,
				indexAttempted,
				indexError,
				indexedSectionCount:sections.length,
				provenanceSectionCount:enriched,
				searchOwner:'panel-library',
				contextOwner:'mcp-oss-ccs',
				sourceMapPreserved:true,
				updatedAt:new Date().toISOString()
			}
		}
	};
	canonical.updatedAt=new Date().toISOString();
	await saveLibrary(workspaceId,state);
	return {synced:true,itemId,indexed,indexAttempted,indexError,indexedSections:sections.length,provenanceSections:enriched,sourceAssetId:apex.sourceAssetId||null};
}
