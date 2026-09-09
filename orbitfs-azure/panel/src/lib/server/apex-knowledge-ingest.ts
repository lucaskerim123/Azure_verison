import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { STORAGE_BUCKET, storagePath } from '$lib/server/base-compat';
import { assertComponentLicensed } from '$lib/server/component-license';
import { getEngineStatus } from '$lib/server/engine-host';
import { getWorkspace, requireWorkspacePermission } from '$lib/server/workspaces';
import {
	LIBRARY_ROLES,
	createLibraryItem,
	libraryContext,
	readLibrary,
	updateLibraryItem
} from '$lib/server/library';
import {
	createApexEngineJob,
	finalizeApexEngineJob,
	getApexEngineJob,
	processApexEngineJob,
	retryApexEngineJob
} from '$lib/server/apex-engine-client';
import type { OrbitUser } from '$lib/server/auth';

const UPLOAD_PREFIX = 'apex.knowledge.upload.';
const DEFAULT_MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['pdf','docx','txt','md','markdown','html','htm','csv','json']);
const MIME_EXTENSION: Record<string,string> = {
	'application/pdf':'pdf',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
	'text/plain':'txt',
	'text/markdown':'md',
	'text/x-markdown':'md',
	'text/html':'html',
	'application/xhtml+xml':'html',
	'text/csv':'csv',
	'application/csv':'csv',
	'application/json':'json',
	'text/json':'json'
};
const ROLE_IDS = new Set(LIBRARY_ROLES.map((role:any) => String(role.id)));
const now = () => new Date().toISOString();
const fail = (message:string,status=400,code='APEX_KNOWLEDGE_IMPORT_FAILED') => Object.assign(new Error(message),{status,code});

type ImportMode = 'knowledge'|'reference'|'draft';
type ReviewAction = 'create_new'|'revision'|'use_existing';

type PendingUpload = {
	version:number;
	uploadId:string;
	workspaceId:string;
	userId:string;
	fileName:string;
	safeFileName:string;
	mimeType:string;
	sizeBytes:number;
	extension:string;
	importMode:ImportMode;
	sourcePath:string;
	storagePath:string;
	createdAt:string;
	expiresAt:string;
	sourceId?:string|null;
	registeredAt?:string|null;
	jobId?:string|null;
};

function importMode(value:unknown):ImportMode {
	const mode=String(value||'knowledge').toLowerCase();
	return mode==='reference'?'reference':mode==='draft'?'draft':'knowledge';
}

function safeFilename(value:unknown) {
	const original=String(value||'document').trim().replace(/\\/g,'/').split('/').pop()||'document';
	const safe=original.normalize('NFKC').replace(/[^a-zA-Z0-9._() -]+/g,'_').replace(/\s+/g,' ').trim().slice(0,180);
	return safe && safe !== '.' && safe !== '..' ? safe : 'document';
}

function sourceExtension(fileName:string,mimeType:string) {
	const suffix=(fileName.includes('.')?fileName.split('.').pop():'')?.toLowerCase()||'';
	if(SUPPORTED_EXTENSIONS.has(suffix)) return suffix;
	const mime=String(mimeType||'').split(';')[0].trim().toLowerCase();
	return MIME_EXTENSION[mime]||suffix;
}

async function assertApexKnowledgeAccess(user:OrbitUser,workspaceId:string) {
	await assertComponentLicensed('orbitfs_apex');
	const workspace=await getWorkspace(workspaceId);
	await requireWorkspacePermission(user,workspace,'sorter_scan');
	const context=await libraryContext(user,workspaceId);
	if(!context.canManage) throw fail('Library management permission is required to import Knowledge',403,'LIBRARY_MANAGE_REQUIRED');
	const engine=await getEngineStatus('apex');
	if(!engine.installed) throw fail('Install APEX before importing Knowledge',409,'APEX_NOT_INSTALLED');
	if(!engine.attached) throw fail('Attach APEX before importing Knowledge',409,'APEX_NOT_ATTACHED');
	if(!engine.configured) throw fail('Complete APEX first-time setup before importing Knowledge',409,'APEX_SETUP_REQUIRED');
	if(!engine.available) throw fail('APEX is currently unavailable',503,'APEX_UNAVAILABLE');
	if(engine.mode==='stopped') throw fail('APEX is stopped. Start it before importing Knowledge',423,'APEX_STOPPED');
	return {workspace,engine};
}

async function maxSourceBytes(workspaceId:string) {
	const db=getSupabaseAdmin();
	const result=await db.from('orbitfs_settings').select('value').eq('scope_type','workspace').eq('scope_id',workspaceId).eq('key','apex.processing.settings').maybeSingle();
	if(result.error) throw result.error;
	const configured=Number((result.data?.value as any)?.maxSourceBytes||DEFAULT_MAX_SOURCE_BYTES);
	return Number.isFinite(configured)?Math.max(1024*1024,Math.min(250*1024*1024,configured)):DEFAULT_MAX_SOURCE_BYTES;
}

async function savePending(upload:PendingUpload) {
	const db=getSupabaseAdmin();
	const result=await db.from('orbitfs_settings').upsert({
		scope_type:'workspace',scope_id:upload.workspaceId,key:`${UPLOAD_PREFIX}${upload.uploadId}`,value:upload,updated_at:now()
	},{onConflict:'scope_type,scope_id,key'});
	if(result.error) throw result.error;
	return upload;
}

async function readPending(workspaceId:string,uploadId:string,userId:string) {
	const db=getSupabaseAdmin();
	const result=await db.from('orbitfs_settings').select('value').eq('scope_type','workspace').eq('scope_id',workspaceId).eq('key',`${UPLOAD_PREFIX}${uploadId}`).maybeSingle();
	if(result.error) throw result.error;
	const upload=result.data?.value as PendingUpload|undefined;
	if(!upload || upload.workspaceId!==workspaceId) throw fail('APEX upload ticket was not found',404,'APEX_UPLOAD_NOT_FOUND');
	if(upload.userId!==userId) throw fail('APEX upload ticket belongs to another user',403,'APEX_UPLOAD_FORBIDDEN');
	if(new Date(upload.expiresAt).getTime()<Date.now() && !upload.sourceId) throw fail('APEX upload ticket has expired',410,'APEX_UPLOAD_EXPIRED');
	return upload;
}

export async function prepareApexKnowledgeUpload(user:OrbitUser,workspaceId:string,input:any={}) {
	await assertApexKnowledgeAccess(user,workspaceId);
	const fileName=safeFilename(input.fileName||input.name);
	const mimeType=String(input.mimeType||'application/octet-stream').split(';')[0].trim().toLowerCase();
	const sizeBytes=Math.max(0,Math.round(Number(input.sizeBytes||0)));
	if(!sizeBytes) throw fail('Choose a non-empty document to upload',400,'APEX_SOURCE_EMPTY');
	const extension=sourceExtension(fileName,mimeType);
	if(!SUPPORTED_EXTENSIONS.has(extension)) throw fail('APEX accepts PDF, DOCX, TXT, MD, HTML, CSV and JSON Knowledge sources',415,'APEX_SOURCE_TYPE_UNSUPPORTED');
	const limit=await maxSourceBytes(workspaceId);
	if(sizeBytes>limit) throw fail(`APEX source exceeds the ${Math.round(limit/1024/1024)} MB workspace import limit`,413,'APEX_SOURCE_TOO_LARGE');
	const uploadId=`apu_${randomUUID()}`;
	const sourcePath=`_media/apex-knowledge-sources/${uploadId}/${fileName}`;
	const objectPath=storagePath(workspaceId,sourcePath);
	const db=getSupabaseAdmin();
	const signed=await db.storage.from(STORAGE_BUCKET).createSignedUploadUrl(objectPath);
	if(signed.error || !signed.data?.signedUrl) throw fail(signed.error?.message||'Could not prepare APEX source upload',503,'APEX_UPLOAD_PREPARE_FAILED');
	const stamp=now();
	const pending:PendingUpload={
		version:1,uploadId,workspaceId,userId:String(user.id),fileName:String(input.fileName||fileName),safeFileName:fileName,mimeType,sizeBytes,extension,
		importMode:importMode(input.importMode),sourcePath,storagePath:objectPath,createdAt:stamp,expiresAt:new Date(Date.now()+2*60*60*1000).toISOString(),sourceId:null,registeredAt:null,jobId:null
	};
	await savePending(pending);
	return {
		uploadId,
		signedUrl:signed.data.signedUrl,
		storagePath:objectPath,
		fileName,
		mimeType,
		sizeBytes,
		importMode:pending.importMode,
		expiresAt:pending.expiresAt
	};
}

async function registerUploadedSource(user:OrbitUser,workspaceId:string,uploadId:string) {
	const upload=await readPending(workspaceId,uploadId,String(user.id));
	if(upload.sourceId) {
		const db=getSupabaseAdmin();
		const existing=await db.from('orbitfs_files').select('*').eq('id',upload.sourceId).eq('workspace_id',workspaceId).maybeSingle();
		if(existing.error) throw existing.error;
		if(existing.data) return {upload,source:existing.data};
	}
	const db=getSupabaseAdmin();
	const slash=upload.storagePath.lastIndexOf('/');
	const folder=slash>=0?upload.storagePath.slice(0,slash):'';
	const objectName=slash>=0?upload.storagePath.slice(slash+1):upload.storagePath;
	const listed=await db.storage.from(STORAGE_BUCKET).list(folder,{limit:10,search:objectName});
	if(listed.error) throw fail(listed.error.message,503,'APEX_UPLOAD_VERIFY_FAILED');
	const object=(listed.data||[]).find((item:any)=>item.name===objectName);
	if(!object) throw fail('The source upload has not finished yet',409,'APEX_UPLOAD_INCOMPLETE');
	const actualSize=Number((object as any)?.metadata?.size||upload.sizeBytes);
	if(Number.isFinite(actualSize) && actualSize!==upload.sizeBytes) throw fail('Uploaded source size does not match the prepared document',409,'APEX_UPLOAD_SIZE_MISMATCH');
	const inserted=await db.from('orbitfs_files').insert({
		workspace_id:workspaceId,
		name:upload.safeFileName,
		path:upload.sourcePath,
		kind:'file',
		mime_type:upload.mimeType,
		content_text:'',
		storage_path:upload.storagePath,
		size_bytes:upload.sizeBytes,
		created_by:user.id,
		updated_at:now()
	}).select('*').single();
	if(inserted.error) throw inserted.error;
	upload.sourceId=String(inserted.data.id);upload.registeredAt=now();await savePending(upload);
	return {upload,source:inserted.data};
}

function lifecycleFor(mode:ImportMode) {
	return mode==='reference'?'reference_only':mode==='draft'?'draft':'current';
}

function routingRole(result:any) {
	const suggestions=Array.isArray(result?.routing?.suggestions)?result.routing.suggestions:[];
	const ranked=suggestions
		.filter((item:any)=>item?.kind==='knowledge_record_add' && ROLE_IDS.has(String(item.role||'')))
		.sort((a:any,b:any)=>Number(b.confidence||0)-Number(a.confidence||0));
	return String(ranked[0]?.role||'general_record_target');
}

function compactSourceMap(result:any) {
	return {
		pages:(result?.pages||[]).map((page:any)=>({page:Number(page.page),startChar:Number(page.startChar||0),endChar:Number(page.endChar||0)})),
		sections:(result?.sections||[]).map((section:any)=>({id:section.id,heading:section.heading,level:section.level,startChar:section.startChar,endChar:section.endChar,pageStart:section.pageStart??null,pageEnd:section.pageEnd??null})),
		chunks:(result?.chunks||[]).map((chunk:any)=>({id:chunk.id,index:chunk.index,heading:chunk.heading||null,startChar:chunk.startChar,endChar:chunk.endChar,pageStart:chunk.pageStart??null,pageEnd:chunk.pageEnd??null,sectionIds:chunk.sectionIds||[],hash:chunk.hash}))
	};
}

async function createKnowledgeFromJob(user:OrbitUser,workspaceId:string,job:any,options:{revisionOf?:string|null;revision?:number;relatedTo?:string|null}={}) {
	const result=job?.result;
	if(!result?.markdown) throw fail('APEX job does not contain a Knowledge package',409,'APEX_RESULT_REQUIRED');
	const state=await readLibrary(workspaceId);
	const already=state.items.find((item:any)=>String(item?.metadata?.apex?.jobId||'')===String(job.id));
	if(already) {
		await finalizeApexEngineJob(workspaceId,String(user.id),String(job.id),String(already.id)).catch(()=>null);
		return {item:already,existing:true};
	}
	const revision=Math.max(1,Number(options.revision||1));
	const route=result.routing?.knowledgeArchitectureRoute||null;
	const category=String(result.metadata?.category||route?.category||'General').slice(0,120);
	const sourceMap=compactSourceMap(result);
	const importedAt=now();
	const apexMetadata={
		jobId:String(job.id),
		processor:String(result.processor||''),
		processingVersion:Number(result.version||0),
		importMode:String(job.importMode||'knowledge'),
		importedAt,
		sourceAssetId:String(result.source?.id||''),
		sourceFilename:String(result.source?.name||job.source?.name||''),
		sourceMimeType:result.source?.mimeType||job.source?.mimeType||null,
		sourceHash:String(result.source?.sourceHash||job.sourceHash||''),
		normalizedHash:String(result.normalizedHash||''),
		pageCount:Number(result.metadata?.pageCount||result.pages?.length||0),
		sectionCount:Number(result.metadata?.sectionCount||result.sections?.length||0),
		chunkCount:Number(result.metadata?.chunkCount||result.chunks?.length||0),
		revision,
		revisionOf:options.revisionOf||null,
		relatedToExistingItemId:options.relatedTo||null,
		duplicate:result.duplicate||null,
		routing:result.routing||null,
		sourceMap
	};
	const created=await createLibraryItem(user,workspaceId,{
		provider:'library.native',
		source:{provider:'library.native',locator:{knowledgeId:`apex:${job.id}`,sourceAssetId:String(result.source?.id||'')}},
		name:String(result.title||result.source?.name||'Imported Knowledge').slice(0,180),
		description:`Imported from ${String(result.source?.name||'source document')} by OrbitFS APEX.`,
		category,
		tags:['APEX import',String(result.source?.extension||'document').toUpperCase()].filter(Boolean),
		purposes:job.importMode==='reference'?['Reference','Source material']:['Context','Source material'],
		roles:[routingRole(result)],
		lifecycleState:lifecycleFor(importMode(job.importMode)),
		visibility:'workspace',
		versionLabel:`Revision ${revision}`,
		content:String(result.markdown),
		contentFormat:'markdown',
		metadata:{apex:apexMetadata,sourceImport:apexMetadata}
	});
	const item=created?.item;
	if(!item?.id) throw fail('Panel Library did not return the created Knowledge item',500,'APEX_LIBRARY_FINALIZE_FAILED');
	await finalizeApexEngineJob(workspaceId,String(user.id),String(job.id),String(item.id));
	return {item,existing:Boolean(created.existing),indexed:Boolean(created.indexed)};
}

export async function completeApexKnowledgeUpload(user:OrbitUser,workspaceId:string,uploadId:string) {
	await assertApexKnowledgeAccess(user,workspaceId);
	const {upload,source}=await registerUploadedSource(user,workspaceId,uploadId);
	let job:any=null;
	if(upload.jobId) job=await getApexEngineJob(workspaceId,String(user.id),upload.jobId).catch(()=>null);
	if(!job) {
		job=await createApexEngineJob({workspaceId,actorUserId:String(user.id),sourceId:String(source.id),importMode:upload.importMode,type:'knowledge_import'});
		if(!job?.id) throw fail('Engine Host did not create an APEX job',503,'APEX_JOB_CREATE_FAILED');
		upload.jobId=String(job.id);await savePending(upload);
	}
	if(job.status==='failed' || job.status==='cancelled') job=await retryApexEngineJob(workspaceId,String(user.id),String(job.id));
	if(job.status==='queued') job=await processApexEngineJob(workspaceId,String(user.id),String(job.id));
	const duplicate=job?.result?.duplicate||null;
	if(job.status==='ready_to_finalize' && duplicate?.kind==='new') {
		const finalized=await createKnowledgeFromJob(user,workspaceId,job);
		return {state:'completed',automatic:true,source,jobId:job.id,knowledge:finalized.item,indexed:finalized.indexed,duplicate};
	}
	if(duplicate?.kind==='exact_duplicate' && duplicate.existingItemId) {
		await finalizeApexEngineJob(workspaceId,String(user.id),String(job.id),String(duplicate.existingItemId));
		return {state:'duplicate',automatic:true,source,jobId:job.id,existingKnowledgeItemId:duplicate.existingItemId,existingKnowledgeItemName:duplicate.existingItemName,duplicate};
	}
	if(job.status==='awaiting_review' && duplicate) {
		return {state:'review_required',automatic:false,source,jobId:job.id,duplicate,title:job.result?.title||source.name,processor:job.result?.processor||null};
	}
	if(job.status==='failed') throw fail(job.error||'APEX processing failed',422,job.errorCode||'APEX_PROCESSING_FAILED');
	return {state:job.status||'processing',automatic:false,source,jobId:job.id,duplicate};
}

export async function reviewApexKnowledgeImport(user:OrbitUser,workspaceId:string,jobId:string,action:ReviewAction) {
	await assertApexKnowledgeAccess(user,workspaceId);
	const job:any=await getApexEngineJob(workspaceId,String(user.id),jobId);
	if(!job?.result) throw fail('APEX job has no processed Knowledge package',409,'APEX_RESULT_REQUIRED');
	const duplicate=job.result.duplicate||{};
	const existingId=String(duplicate.existingItemId||'');
	if(action==='use_existing') {
		if(!existingId) throw fail('APEX did not identify existing Knowledge for this job',409,'APEX_EXISTING_REQUIRED');
		await finalizeApexEngineJob(workspaceId,String(user.id),jobId,existingId);
		return {state:'completed',action,jobId,knowledgeItemId:existingId,existing:true,duplicate};
	}
	if(action==='create_new') {
		const finalized=await createKnowledgeFromJob(user,workspaceId,job,{relatedTo:existingId||null});
		return {state:'completed',action,jobId,knowledge:finalized.item,indexed:finalized.indexed,duplicate};
	}
	if(action==='revision') {
		if(!existingId) throw fail('APEX did not identify a Knowledge item to revise',409,'APEX_EXISTING_REQUIRED');
		const state=await readLibrary(workspaceId);
		const previous=state.items.find((item:any)=>String(item.id)===existingId);
		if(!previous) throw fail('The Knowledge item selected for revision no longer exists',404,'APEX_EXISTING_NOT_FOUND');
		const nextRevision=Math.max(2,Number(previous?.metadata?.apex?.revision||1)+1);
		const finalized=await createKnowledgeFromJob(user,workspaceId,job,{revisionOf:existingId,revision:nextRevision});
		if((previous.lifecycleState||previous.lifecycle)!=='old') await updateLibraryItem(user,workspaceId,existingId,{lifecycleState:'old'});
		return {state:'completed',action,jobId,knowledge:finalized.item,previousKnowledgeItemId:existingId,revision:nextRevision,indexed:finalized.indexed,duplicate};
	}
	throw fail('Unknown APEX review action',400,'APEX_REVIEW_ACTION_INVALID');
}

export async function getApexKnowledgeImportJob(user:OrbitUser,workspaceId:string,jobId:string) {
	await assertApexKnowledgeAccess(user,workspaceId);
	return getApexEngineJob(workspaceId,String(user.id),jobId);
}