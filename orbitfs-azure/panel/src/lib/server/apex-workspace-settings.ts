import type { OrbitUser } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { getWorkspace, requireWorkspacePermission } from '$lib/server/workspaces';

const SORTER_KEY = 'apex.sorter.settings';
const CONVERTER_KEY = 'apex.converter.settings';
const now = () => new Date().toISOString();
const fail = (message:string,status=400,code='APEX_SETTINGS_ERROR') => Object.assign(new Error(message),{status,code});

export const APEX_SORTER_DEFAULTS = {
	enabled: true,
	automaticAnalysis: true,
	requireApproval: true,
	autoApply: false,
	learning: true,
	recursive: true,
	includeScopes: ['library','knowledge'],
	excludeScopes: ['archive','trash'],
	mode: 'approval_queue',
	maxItemsPerRun: 100,
	minConfidence: 0.75,
	rules: [] as any[]
};

export const APEX_CONVERTER_DEFAULTS = {
	preserveSource: true,
	allowOverwrite: false,
	maxConcurrentJobs: 2,
	timeoutSeconds: 120,
	defaultImportMode: 'knowledge',
	defaults: { image:'png', video:'mp4', audio:'mp3', office:'pdf', document:'markdown' },
	image: { quality:90, stripMetadata:false },
	video: { preset:'medium', codec:'h264' },
	audio: { codec:'aac', bitrateKbps:192 },
	office: { keepOriginal:true }
};

const objectValue = (value:any) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const bool = (value:any,fallback:boolean) => value === undefined ? fallback : value === true;
const bounded = (value:any,fallback:number,min:number,max:number) => {
	const number = Number(value);
	return Number.isFinite(number) ? Math.max(min,Math.min(max,number)) : fallback;
};
const strings = (value:any,fallback:string[],limit=50) => Array.isArray(value)
	? value.map((item) => String(item||'').trim()).filter(Boolean).slice(0,limit)
	: fallback;

function sanitizeRules(value:any) {
	if(!Array.isArray(value)) return [];
	return value.slice(0,100).map((raw:any,index:number) => ({
		id: String(raw?.id || `rule-${index+1}`).slice(0,80),
		enabled: raw?.enabled !== false,
		name: String(raw?.name || `Rule ${index+1}`).slice(0,120),
		extensions: strings(raw?.extensions,[],30).map((item) => item.replace(/^\./,'').toLowerCase()),
		categories: strings(raw?.categories,[],30),
		minConfidence: bounded(raw?.minConfidence,0.75,0,1),
		target: String(raw?.target || 'knowledge').slice(0,120),
		convertTo: String(raw?.convertTo || '').slice(0,40) || null
	}));
}

function sanitizeSorter(input:any={}) {
	const current = {...APEX_SORTER_DEFAULTS,...objectValue(input)} as any;
	const mode = ['preview','approval_queue','auto_apply'].includes(String(current.mode)) ? String(current.mode) : 'approval_queue';
	return {
		enabled: bool(current.enabled,true),
		automaticAnalysis: bool(current.automaticAnalysis,true),
		requireApproval: mode === 'auto_apply' ? false : bool(current.requireApproval,true),
		autoApply: mode === 'auto_apply' || bool(current.autoApply,false),
		learning: bool(current.learning,true),
		recursive: bool(current.recursive,true),
		includeScopes: strings(current.includeScopes,APEX_SORTER_DEFAULTS.includeScopes,20),
		excludeScopes: strings(current.excludeScopes,APEX_SORTER_DEFAULTS.excludeScopes,20),
		mode,
		maxItemsPerRun: Math.round(bounded(current.maxItemsPerRun,100,1,1000)),
		minConfidence: bounded(current.minConfidence,0.75,0,1),
		rules: sanitizeRules(current.rules)
	};
}

function sanitizeConverter(input:any={}) {
	const current = {...APEX_CONVERTER_DEFAULTS,...objectValue(input)} as any;
	const defaults = {...APEX_CONVERTER_DEFAULTS.defaults,...objectValue(current.defaults)};
	const image = {...APEX_CONVERTER_DEFAULTS.image,...objectValue(current.image)};
	const video = {...APEX_CONVERTER_DEFAULTS.video,...objectValue(current.video)};
	const audio = {...APEX_CONVERTER_DEFAULTS.audio,...objectValue(current.audio)};
	const office = {...APEX_CONVERTER_DEFAULTS.office,...objectValue(current.office)};
	const mode = ['knowledge','reference','draft'].includes(String(current.defaultImportMode)) ? String(current.defaultImportMode) : 'knowledge';
	return {
		preserveSource: bool(current.preserveSource,true),
		allowOverwrite: bool(current.allowOverwrite,false),
		maxConcurrentJobs: Math.round(bounded(current.maxConcurrentJobs,2,1,8)),
		timeoutSeconds: Math.round(bounded(current.timeoutSeconds,120,15,600)),
		defaultImportMode: mode,
		defaults: {
			image:String(defaults.image||'png').slice(0,20), video:String(defaults.video||'mp4').slice(0,20),
			audio:String(defaults.audio||'mp3').slice(0,20), office:String(defaults.office||'pdf').slice(0,20),
			document:String(defaults.document||'markdown').slice(0,20)
		},
		image: { quality:Math.round(bounded(image.quality,90,1,100)), stripMetadata:bool(image.stripMetadata,false) },
		video: { preset:String(video.preset||'medium').slice(0,30), codec:String(video.codec||'h264').slice(0,30) },
		audio: { codec:String(audio.codec||'aac').slice(0,30), bitrateKbps:Math.round(bounded(audio.bitrateKbps,192,32,512)) },
		office: { keepOriginal:bool(office.keepOriginal,true) }
	};
}

async function readSetting(workspaceId:string,key:string) {
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_settings').select('value').eq('scope_type','workspace').eq('scope_id',workspaceId).eq('key',key).maybeSingle();
	if(result.error) throw result.error;
	return objectValue(result.data?.value);
}

async function saveSetting(workspaceId:string,key:string,value:any,user:OrbitUser) {
	const db = getSupabaseAdmin();
	const payload = {...value,updatedAt:now(),updatedBy:user.username};
	const result = await db.from('orbitfs_settings').upsert({scope_type:'workspace',scope_id:workspaceId,key,value:payload,updated_at:now()},{onConflict:'scope_type,scope_id,key'});
	if(result.error) throw result.error;
	return payload;
}

async function requireAnyApexView(user:OrbitUser,workspace:any) {
	for(const permission of ['sorter_view','converter_view']) {
		try { await requireWorkspacePermission(user,workspace,permission); return; } catch {}
	}
	throw fail('APEX workspace access required',403,'APEX_WORKSPACE_ACCESS_REQUIRED');
}

export async function getApexWorkspaceSettings(user:OrbitUser,workspaceId:string) {
	const workspace = await getWorkspace(workspaceId);
	await requireAnyApexView(user,workspace);
	const [sorterRaw,converterRaw] = await Promise.all([readSetting(workspaceId,SORTER_KEY),readSetting(workspaceId,CONVERTER_KEY)]);
	return {workspaceId,sorter:sanitizeSorter(sorterRaw),converter:sanitizeConverter(converterRaw)};
}

export async function saveApexWorkspaceSettings(user:OrbitUser,workspaceId:string,input:any={}) {
	const workspace = await getWorkspace(workspaceId);
	const result:any = {workspaceId};
	if(input.sorter !== undefined) {
		await requireWorkspacePermission(user,workspace,'sorter_manage_rules');
		result.sorter = await saveSetting(workspaceId,SORTER_KEY,sanitizeSorter(input.sorter),user);
	}
	if(input.converter !== undefined) {
		await requireWorkspacePermission(user,workspace,'converter_manage_settings');
		result.converter = await saveSetting(workspaceId,CONVERTER_KEY,sanitizeConverter(input.converter),user);
	}
	if(input.sorter === undefined && input.converter === undefined) throw fail('No APEX settings were supplied',400,'APEX_SETTINGS_REQUIRED');
	return result;
}
