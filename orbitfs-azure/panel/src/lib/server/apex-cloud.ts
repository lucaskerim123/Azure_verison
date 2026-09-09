import type { OrbitUser } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { getWorkspace,requireWorkspacePermission,isSystemAdmin } from '$lib/server/workspaces';
import { analyzeCloudRouting } from '$lib/server/routing-engine-cloud';
import { createLibraryChangeRequest,listLibraryChangeRequests } from '$lib/server/library';
import { getEngineStatus } from '$lib/server/engine-host';
import { listApexEngineJobs } from '$lib/server/apex-engine-client';

const now=()=>new Date().toISOString();
const fail=(m:string,s=400,c='APEX_ERROR')=>Object.assign(new Error(m),{status:s,code:c});
export const APEX_POLICY_DEFAULTS={serviceMode:'on_demand',fullShutdown:false,standby:true,forceManualScan:true,blockAutomation:false,idleTimeoutMs:10000,eventDriven:true};

async function readApexPolicy(){
	const db=getSupabaseAdmin();const r=await db.from('orbitfs_settings').select('value').eq('scope_type','global').eq('scope_id','').eq('key','apex.cloud.policy').maybeSingle();if(r.error)throw r.error;
	const raw=(r.data?.value&&typeof r.data.value==='object')?r.data.value:{} as any;
	return {...APEX_POLICY_DEFAULTS,...raw,serviceMode:raw.serviceMode==='automatic'?'automatic':'on_demand',fullShutdown:raw.fullShutdown===true,standby:raw.standby!==false,forceManualScan:true,blockAutomation:raw.blockAutomation===true,idleTimeoutMs:Math.max(5000,Math.min(300000,Number(raw.idleTimeoutMs||10000))),eventDriven:true};
}

async function readApexWorkspaceProcessingSettings(workspaceId:string){
	const db=getSupabaseAdmin();const r=await db.from('orbitfs_settings').select('value').eq('scope_type','workspace').eq('scope_id',workspaceId).eq('key','apex.processing.settings').maybeSingle();if(r.error)throw r.error;
	const raw=(r.data?.value&&typeof r.data.value==='object')?r.data.value:{} as any;const routing=(raw.routing&&typeof raw.routing==='object')?raw.routing:{};
	return {routing:{knowledgeArchitecture:routing.knowledgeArchitecture!==false,projects:routing.projects!==false,profiles:routing.profiles!==false}};
}

export async function apexPolicy(user:OrbitUser){if(!isSystemAdmin(user))throw fail('System Owner or Admin required',403);return readApexPolicy();}
export async function saveApexPolicy(user:OrbitUser,input:any={}){if(!isSystemAdmin(user))throw fail('System Owner or Admin required',403);const current=await readApexPolicy();const next={...current,serviceMode:input.serviceMode==='automatic'?'automatic':'on_demand',fullShutdown:input.fullShutdown===true,standby:input.standby!==false,forceManualScan:true,blockAutomation:input.blockAutomation===true,idleTimeoutMs:Math.max(5000,Math.min(300000,Number(input.idleTimeoutMs||10000))),eventDriven:true};const db=getSupabaseAdmin();const r=await db.from('orbitfs_settings').upsert({scope_type:'global',scope_id:'',key:'apex.cloud.policy',value:next,updated_at:now()},{onConflict:'scope_type,scope_id,key'});if(r.error)throw r.error;return next;}

export async function apexEngineState(){
	const [engine,policy]=await Promise.all([getEngineStatus('apex').catch(()=>null),readApexPolicy()]);
	const operational=Boolean(engine?.installed&&engine?.attached&&engine?.linked&&engine?.configured&&engine?.available&&engine?.mode!=='stopped'&&!policy.fullShutdown);
	return{state:engine?.mode||'standby',ok:Boolean(engine)&&engine?.available!==false,operational,processingDisabled:policy.fullShutdown,residentProcess:false,mode:'serverless',setupComplete:engine?.configured===true,attached:engine?.attached===true,linked:engine?.linked===true,processing:{available:operational,target:'library-knowledge',eventDriven:true},sorter:{available:false,retired:true,target:null},converter:{state:operational?'knowledge_formats_ready':'unavailable',available:operational,reason:operational?null:policy.fullShutdown?'APEX processing is administratively disabled.':'APEX must be attached, setup and running before Knowledge conversion can run.'}};
}

async function assertApexOperational(){
	const [engine,policy]=await Promise.all([getEngineStatus('apex'),readApexPolicy()]);
	if(!engine.installed)throw fail('Install APEX before using processing or routing',409,'APEX_NOT_INSTALLED');
	if(!engine.attached||!engine.linked)throw fail('Attach APEX to the Shared Engine Host before using processing or routing',409,'APEX_NOT_ATTACHED');
	if(!engine.configured)throw fail('Complete APEX first-time setup before using processing or routing',409,'APEX_SETUP_REQUIRED');
	if(!engine.available)throw fail('APEX is currently unavailable',503,'APEX_UNAVAILABLE');
	if(engine.mode==='stopped')throw fail('APEX is stopped. Start it before using processing or routing',423,'APEX_STOPPED');
	if(policy.fullShutdown)throw fail('APEX processing is disabled by the system administrator',423,'APEX_SHUTDOWN');
	return {engine,policy};
}

export async function apexWorkspaceStatus(user:OrbitUser,workspaceId:string){
	const ws=await getWorkspace(workspaceId);await requireWorkspacePermission(user,ws,'sorter_view');const requests=await listLibraryChangeRequests(user,workspaceId,{sourceSystem:'apex'});const engine=await getEngineStatus('apex').catch(()=>null);let jobs:any[]=[];let processingError:string|null=null;
	if(engine?.configured&&engine?.attached&&engine?.linked){try{jobs=await listApexEngineJobs(workspaceId,String(user.id));}catch(error:any){processingError=String(error?.message||error||'Engine job status unavailable');}}
	else processingError=engine?.attached?'Complete APEX first-time setup to use processing.':'Attach APEX to the Shared Engine Host to use processing.';
	const activeStatuses=new Set(['queued','processing','ready_to_finalize']);const reviewStatuses=new Set(['awaiting_review']);const [state,policy]=await Promise.all([apexEngineState(),readApexPolicy()]);
	return{workspaceId,engine:{...state,deployment:engine?.deployment||'ready'},policy,processing:{jobs,active:jobs.filter((job:any)=>activeStatuses.has(String(job.status))),review:jobs.filter((job:any)=>reviewStatuses.has(String(job.status))),history:jobs.filter((job:any)=>!activeStatuses.has(String(job.status))&&!reviewStatuses.has(String(job.status))).slice(0,100),error:processingError},queue:(requests.requests||[]).filter((x:any)=>['pending','needs_target','applying'].includes(x.status)),history:(requests.requests||[]).filter((x:any)=>!['pending','needs_target','applying'].includes(x.status)).slice(0,100),filesystem:false};
}

export async function apexAnalyze(user:OrbitUser,workspaceId:string,input:any={}){
	const ws=await getWorkspace(workspaceId);await requireWorkspacePermission(user,ws,'sorter_scan');const {policy}=await assertApexOperational();
	if(input.automatic===true&&policy.serviceMode!=='automatic')throw fail('Automatic APEX routing is disabled; processing is currently on demand',403,'APEX_AUTOMATION_DISABLED');
	if(policy.blockAutomation&&input.automatic===true)throw fail('APEX automation is blocked by the system administrator',403,'APEX_AUTOMATION_BLOCKED');
	const processing=await readApexWorkspaceProcessingSettings(workspaceId),routing=processing.routing;
	return analyzeCloudRouting(user,workspaceId,input.entry||input,{...(input.settings||{}),enabled:true,allowKnowledge:routing.knowledgeArchitecture,allowProjects:routing.projects,allowProfiles:routing.profiles});
}

export async function apexQueueSuggestion(user:OrbitUser,workspaceId:string,input:any={}){
	const ws=await getWorkspace(workspaceId);await requireWorkspacePermission(user,ws,'sorter_add_to_queue');await assertApexOperational();
	const processing=await readApexWorkspaceProcessingSettings(workspaceId),routing=processing.routing,suggestion=input.suggestion||{},entry=input.entry||{};
	if(suggestion.kind==='profile_record_add'&&!routing.profiles)throw fail('Profile routing is disabled in APEX configuration',403,'APEX_ROUTING_TARGET_DISABLED');
	if(['knowledge_record_add','library_item_update'].includes(String(suggestion.kind))&&!routing.knowledgeArchitecture)throw fail('Knowledge routing is disabled in APEX configuration',403,'APEX_ROUTING_TARGET_DISABLED');
	if((suggestion.architectureRoute?.scope==='project'||suggestion.architectureRoute?.projectId)&&!routing.projects)throw fail('Project routing is disabled in APEX configuration',403,'APEX_ROUTING_TARGET_DISABLED');
	let operation:any;
	if(suggestion.kind==='profile_record_add')operation={type:'profile_record_add',profileId:suggestion.profileId||null,sectionId:suggestion.sectionId||'records',title:entry.title||suggestion.label||'APEX suggestion',content:entry.content||entry.content_text||'',date:entry.date||entry.entryDate||null,category:entry.category||'apex'};
	else if(suggestion.kind==='library_item_update'&&suggestion.itemId)operation={type:'library_item_update',itemId:suggestion.itemId,patch:{content:entry.content||entry.content_text||''}};
	else operation={type:'knowledge_record_add',role:suggestion.role||'general_record_target',itemId:suggestion.existing?.itemId||null,title:entry.title||suggestion.label||'APEX suggestion',content:entry.content||entry.content_text||'',date:entry.date||entry.entryDate||null,category:entry.category||'apex'};
	const request=await createLibraryChangeRequest(user,workspaceId,{source:{system:'apex',title:entry.title||suggestion.label||'APEX routing suggestion'},sourceSnapshot:{entry,suggestion},summary:`APEX: ${entry.title||suggestion.label||'Knowledge routing suggestion'}`,reason:suggestion.reason||input.reason||'APEX routing suggestion',operations:[operation]});return{queued:true,request};
}
