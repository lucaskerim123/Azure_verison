import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertComponentLicensed } from '$lib/server/component-license';
import {
  createStudioDocument, deleteStudioShare, getStudioDocument, listStudioDocuments,
  restoreStudioRevision, saveStudioShare, setStudioLifecycle, studioPeople, studioProfiles,
  studioRevisions, studioSchema, studioShares, updateStudioDocument
} from '$lib/server/studio-cloud';
import { createLibraryChangeRequest, listLibraryChangeRequests } from '$lib/server/library';
import { listCloudAnalysisRuns,startCloudAnalysis,getCloudAnalysisRun,createCloudAnalysisProposals } from '$lib/server/studio-analysis-cloud';

const clean=(v:any)=>String(v??'').trim();
const fail=(e:any)=>json({error:String(e?.message||'Studio request failed'),code:String(e?.code||'STUDIO_ERROR')},{status:Number(e?.status||500)});
async function ctx(cookies:any){const user=await requireUser(cookies);await assertComponentLicensed('orbitfs_studio');return user;}
async function body(request:Request){return request.headers.get('content-type')?.includes('application/json')?await request.json():{};}
function route(params:any){const p=clean(params.path).split('/').filter(Boolean);if(p[0]!=='workspaces'||!p[1])throw Object.assign(new Error('Studio route not found'),{status:404});return {workspaceId:p[1],area:p[2]||'',id:p[3]||'',operation:p[4]||''};}

export async function GET({params,url,cookies}:any){try{
  const user=await ctx(cookies),r=route(params);
  if(r.area==='schema')return json(studioSchema());
  if(r.area==='profiles')return json(await studioProfiles(user,r.workspaceId));
  if(r.area==='people')return json(await studioPeople(user,r.workspaceId));
  if(r.area==='analysis'&&!r.id)return json(await listCloudAnalysisRuns(user,r.workspaceId,Number(url.searchParams.get('limit')||50)));
  if(r.area==='analysis'&&r.id&&!r.operation)return json({analysis:await getCloudAnalysisRun(user,r.workspaceId,r.id,url.searchParams.get('records')==='1')});
  if(r.area==='documents'&&!r.id)return json(await listStudioDocuments(user,r.workspaceId,url.searchParams));
  if(r.area==='documents'&&r.id&&!r.operation)return json(await getStudioDocument(user,r.workspaceId,r.id));
  if(r.area==='documents'&&r.id&&r.operation==='revisions')return json(await studioRevisions(user,r.workspaceId,r.id));
  if(r.area==='documents'&&r.id&&r.operation==='shares')return json(await studioShares(user,r.workspaceId,r.id));
  if(r.area==='documents'&&r.id&&r.operation==='proposals')return json(await listLibraryChangeRequests(user,r.workspaceId,{sourceSystem:'studio',sourceEntryId:r.id}));
  throw Object.assign(new Error('Studio route not found'),{status:404});
}catch(e){return fail(e);}}
export async function POST({params,request,cookies}:any){try{
  const user=await ctx(cookies),r=route(params),input=await body(request);
  if(r.area==='analysis'&&!r.id)return json({analysis:await startCloudAnalysis(user,r.workspaceId,input)});
  if(r.area==='analysis'&&r.id&&r.operation==='proposals')return json({proposals:await createCloudAnalysisProposals(user,r.workspaceId,r.id,input)});
  if(r.area==='analysis'&&r.id&&r.operation==='cancel')return json({error:'Cloud analysis runs execute synchronously and cannot be cancelled after the request completes.',analysis:await getCloudAnalysisRun(user,r.workspaceId,r.id,false)},{status:409});
  if(r.area==='documents'&&!r.id)return json(await createStudioDocument(user,r.workspaceId,input));
  if(r.area==='documents'&&r.id&&['finalize','archive','draft'].includes(r.operation))return json(await setStudioLifecycle(user,r.workspaceId,r.id,r.operation as any));
  if(r.area==='documents'&&r.id&&r.operation==='restore-revision')return json(await restoreStudioRevision(user,r.workspaceId,r.id,Number(input.revisionNo)));
  if(r.area==='documents'&&r.id&&r.operation==='shares')return json(await saveStudioShare(user,r.workspaceId,r.id,input));
  if(r.area==='documents'&&r.id&&r.operation==='proposals'){const doc=(await getStudioDocument(user,r.workspaceId,r.id)).item,meta=doc.metadata_json||{},roleMap:any={incident:'incident_log',timeline:'timeline',evidence:'evidence_target',reference:'reference_target'};const operation=String(doc.subtype)==='profile-record'?{type:'profile_record_add',profileId:String(meta.profileTargetId||''),sectionId:String(meta.profileSectionId||'records'),title:doc.title,content:doc.content_text,date:doc.entry_date,category:String(meta.category||'general')}:{type:'append_to_role',role:roleMap[String(doc.subtype)]||'general_record_target',title:doc.title,content:doc.content_text,date:doc.entry_date,category:String(meta.category||'general')};const request=await createLibraryChangeRequest(user,r.workspaceId,{source:{system:'studio',entryId:doc.id,revision:doc.current_revision,title:doc.title},sourceSnapshot:{entryId:doc.id,revision:doc.current_revision,status:doc.status},summary:`Publish Studio entry: ${doc.title}`,operations:[operation]});return json({request});}
  throw Object.assign(new Error('Studio route not found'),{status:404});
}catch(e){return fail(e);}}

export async function PATCH({params,request,cookies}:any){try{
  const user=await ctx(cookies),r=route(params),input=await body(request);
  if(r.area==='documents'&&r.id&&!r.operation)return json(await updateStudioDocument(user,r.workspaceId,r.id,input));
  throw Object.assign(new Error('Studio route not found'),{status:404});
}catch(e){return fail(e);}}

export async function DELETE({params,url,cookies}:any){try{
  const user=await ctx(cookies),r=route(params);
  if(r.area==='documents'&&r.id&&r.operation==='shares')return json(await deleteStudioShare(user,r.workspaceId,r.id,clean(url.searchParams.get('userId'))));
  throw Object.assign(new Error('Studio route not found'),{status:404});
}catch(e){return fail(e);}}
