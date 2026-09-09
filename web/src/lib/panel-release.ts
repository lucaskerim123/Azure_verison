import {createHash,timingSafeEqual} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {licenseDb,runtimeLicenseSettings} from "@/lib/license-api";

const BUCKET="orbitfs-panel-releases";
const LEGACY_LATEST_PATH="panel/latest.json";
const META_DIR="panel/meta";
const CHANNEL_DIR="panel/channels";
const MAX_RELEASE_BYTES=40*1024*1024;
const DOWNLOAD_SECONDS=300;
const PANEL_COMPONENT="orbitfs_base";

export type PanelReleaseChannel="base"|"update";
export type PanelReleaseStatus="draft"|"published"|"paused"|"superseded"|"withdrawn"|"failed";
export type PanelReleaseRollout="internal"|"beta"|"public";
export type PanelReleaseSeverity="normal"|"important"|"critical";

export type PanelReleaseManifest={
  format:"orbitfs-panel-release-v1";
  version:string;
  releaseId:string;
  sourceCommit:string|null;
  createdAt:string;
  schemaVersion?:string;
  releaseChannel?:string;
  components?:string[];
  minimumVersion?:string|null;
  rollbackVersion?:string|null;
  projectSettings:{framework?:string;buildCommand?:string;installCommand?:string;outputDirectory?:string};
  files:Array<{file:string;data:string;encoding:"base64"|"utf-8";size?:number}>;
};

export type StoredPanelRelease={
  version:string;
  releaseId:string;
  sourceCommit:string|null;
  schemaVersion:string;
  sha256:string;
  size:number;
  fileCount:number;
  objectPath:string;
  projectSettings:PanelReleaseManifest["projectSettings"];
  channel:PanelReleaseChannel;
  status:PanelReleaseStatus;
  title:string;
  description:string;
  changelog:string;
  customerNotes:string;
  internalNotes:string;
  severity:PanelReleaseSeverity;
  required:boolean;
  minimumVersion:string|null;
  rollbackVersion:string|null;
  rollout:PanelReleaseRollout;
  components:string[];
  createdAt:string;
  candidateAt:string;
  publishedAt:string|null;
  updatedAt:string;
};

export type PanelReleaseDraftPatch=Partial<Pick<StoredPanelRelease,"channel"|"title"|"description"|"changelog"|"customerNotes"|"internalNotes"|"severity"|"required"|"minimumVersion"|"rollbackVersion"|"rollout"|"components">>;

function safeEqual(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)}
function validVersion(value:string){return /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(String(value||""))}
export function normalizePanelReleaseChannel(value:any):PanelReleaseChannel{const v=String(value||"").trim().toLowerCase();if(v==="base")return "base";if(v==="update"||v==="updates")return "update";throw new Error("Panel release channel must be base or update")}
function normalizeComponents(value:any){const raw=Array.isArray(value)?value:String(value||"").split(",");return [...new Set(raw.map((x:any)=>String(x||"").trim().toLowerCase()).filter(Boolean))].slice(0,50)}
function normalizeNullableVersion(value:any){const v=String(value||"").trim();if(!v)return null;if(!validVersion(v))throw new Error(`Invalid release version: ${v}`);return v}
function metaPath(version:string){return `${META_DIR}/${version}.json`}
function channelPath(channel:PanelReleaseChannel){return `${CHANNEL_DIR}/${channel}.json`}

export async function authorizePanelReleasePublisher(req:Request){
  const supplied=String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  let expected="";
  try{const {data}=await licenseDb().rpc("service_orbitfs_release_secret",{p_key:"panel_publish_token"});expected=String(data||"").trim()}catch{}
  if(!expected)expected=String(process.env.ORBITFS_PANEL_RELEASE_PUBLISH_TOKEN||"").trim();
  if(!expected)return {ok:false as const,status:503,error:"Panel release publishing is not configured",code:"PANEL_RELEASE_PUBLISH_NOT_CONFIGURED"};
  if(!supplied||!safeEqual(supplied,expected))return {ok:false as const,status:401,error:"Invalid release publisher token",code:"PANEL_RELEASE_PUBLISH_UNAUTHORIZED"};
  return {ok:true as const};
}

function safeReleasePath(path:string){const p=String(path||"").trim().replace(/\\/g,"/");return !!p&&!p.startsWith("/")&&!p.startsWith("../")&&!p.includes("/../")&&!p.includes("\0")}
export function inspectPanelRelease(bytes:Buffer,expectedVersion=""){
  if(!bytes.length||bytes.length>MAX_RELEASE_BYTES)throw new Error("Panel release package size is invalid");
  const sha256=createHash("sha256").update(bytes).digest("hex"),decoded=gunzipSync(bytes,{maxOutputLength:120*1024*1024}),manifest=JSON.parse(decoded.toString("utf8")) as PanelReleaseManifest;
  if(manifest?.format!=="orbitfs-panel-release-v1")throw new Error("Unsupported Panel release format");
  if(!validVersion(String(manifest.version||"")))throw new Error("Panel release version is invalid");
  if(expectedVersion&&manifest.version!==expectedVersion)throw new Error("Panel release version header does not match package");
  manifest.schemaVersion=String(manifest.schemaVersion||"1");
  if(!validVersion(manifest.schemaVersion))throw new Error("Panel schema version is invalid");
  if(!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>4000)throw new Error("Panel release file list is invalid");
  const seen=new Set<string>();
  for(const file of manifest.files){if(!safeReleasePath(file.file)||seen.has(file.file))throw new Error(`Unsafe or duplicate Panel release path: ${file.file}`);seen.add(file.file);if(!["base64","utf-8"].includes(file.encoding))throw new Error(`Unsupported Panel release encoding for ${file.file}`);if(typeof file.data!=="string")throw new Error(`Panel release file data is invalid for ${file.file}`)}
  if(!seen.has("package.json")||![...seen].some(p=>p.startsWith("src/")))throw new Error("Panel release is missing required project files");
  return {manifest,sha256};
}

async function ensureReleaseBucket(){const db=licenseDb();const current=await db.storage.getBucket(BUCKET);if(current.data)return db;const created=await db.storage.createBucket(BUCKET,{public:false,fileSizeLimit:MAX_RELEASE_BYTES});if(created.error&&!String(created.error.message||"").toLowerCase().includes("already"))throw created.error;return db}
async function readJson<T>(path:string):Promise<T|null>{const db=await ensureReleaseBucket(),d=await db.storage.from(BUCKET).download(path);if(d.error||!d.data)return null;try{return JSON.parse(await d.data.text()) as T}catch{return null}}
async function writeJson(path:string,value:any){const db=await ensureReleaseBucket(),u=await db.storage.from(BUCKET).upload(path,Buffer.from(JSON.stringify(value)),{contentType:"application/json",upsert:true,cacheControl:"0"});if(u.error)throw u.error}
async function readStoredMetadata(version:string){const value=await readJson<StoredPanelRelease>(metaPath(version));return value?normalizeStored(value):null}
async function setChannelPointer(channel:PanelReleaseChannel,version:string|null){await writeJson(channelPath(channel),{channel,version,updatedAt:new Date().toISOString()})}

function normalizeStored(value:any,defaults:Partial<StoredPanelRelease>={}):StoredPanelRelease{
  const now=new Date().toISOString(),channel=normalizePanelReleaseChannel(value?.channel||defaults.channel||"base");
  return {
    version:String(value?.version||defaults.version||""),releaseId:String(value?.releaseId||defaults.releaseId||`panel-${value?.version||defaults.version||"unknown"}`),sourceCommit:String(value?.sourceCommit||defaults.sourceCommit||"").trim()||null,
    schemaVersion:String(value?.schemaVersion||defaults.schemaVersion||"1"),sha256:String(value?.sha256||defaults.sha256||""),size:Number(value?.size||defaults.size||0),fileCount:Number(value?.fileCount||defaults.fileCount||0),objectPath:String(value?.objectPath||defaults.objectPath||""),projectSettings:value?.projectSettings||defaults.projectSettings||{},
    channel,status:(value?.status||defaults.status||"published") as PanelReleaseStatus,title:String(value?.title||defaults.title||`OrbitFS ${value?.version||defaults.version||""}`),description:String(value?.description||defaults.description||""),changelog:String(value?.changelog||defaults.changelog||""),customerNotes:String(value?.customerNotes||defaults.customerNotes||""),internalNotes:String(value?.internalNotes||defaults.internalNotes||""),severity:(value?.severity||defaults.severity||"normal") as PanelReleaseSeverity,required:Boolean(value?.required??defaults.required??false),minimumVersion:normalizeNullableVersion(value?.minimumVersion??defaults.minimumVersion??null),rollbackVersion:normalizeNullableVersion(value?.rollbackVersion??defaults.rollbackVersion??null),rollout:(value?.rollout||defaults.rollout||"public") as PanelReleaseRollout,components:normalizeComponents(value?.components||defaults.components||["core"]),
    createdAt:String(value?.createdAt||defaults.createdAt||value?.publishedAt||now),candidateAt:String(value?.candidateAt||defaults.candidateAt||value?.publishedAt||now),publishedAt:value?.publishedAt?String(value.publishedAt):(defaults.publishedAt?String(defaults.publishedAt):null),updatedAt:String(value?.updatedAt||defaults.updatedAt||value?.publishedAt||now)
  };
}

export async function submitPanelReleaseDraft(bytes:Buffer,input:{version:string;sha256?:string|null;sourceCommit?:string|null;channel?:string|null;components?:string[]|string|null;minimumVersion?:string|null;rollbackVersion?:string|null}){
  const {manifest,sha256}=inspectPanelRelease(bytes,input.version);if(input.sha256&&String(input.sha256).toLowerCase()!==sha256)throw new Error("Panel release checksum header does not match package");
  const channel=normalizePanelReleaseChannel(input.channel||manifest.releaseChannel||"base"),components=normalizeComponents(input.components||manifest.components||(channel==="base"?["core"]:["core","addons"]));
  const db=await ensureReleaseBucket(),objectPath=`panel/${manifest.version}/release.json.gz`,existing=await db.storage.from(BUCKET).download(objectPath);
  if(existing.data&&!existing.error){const existingBytes=Buffer.from(await existing.data.arrayBuffer()),existingSha=createHash("sha256").update(existingBytes).digest("hex");if(existingSha!==sha256)throw new Error("Panel release version already exists with a different checksum; publish a new version")}else{const uploaded=await db.storage.from(BUCKET).upload(objectPath,bytes,{contentType:"application/gzip",upsert:false,cacheControl:"31536000"});if(uploaded.error)throw uploaded.error}
  const current=await readStoredMetadata(manifest.version);if(current&&current.sha256&&current.sha256!==sha256)throw new Error("Stored release metadata checksum does not match package");if(current&&current.channel!==channel&&current.status!=="draft")throw new Error("Published release channel cannot be changed");
  const now=new Date().toISOString(),metadata:StoredPanelRelease=normalizeStored({...current,version:manifest.version,releaseId:String(manifest.releaseId||`panel-${manifest.version}`),sourceCommit:String(input.sourceCommit||manifest.sourceCommit||"").trim()||null,schemaVersion:String(manifest.schemaVersion||"1"),sha256,size:bytes.length,fileCount:manifest.files.length,objectPath,projectSettings:manifest.projectSettings||{},channel,components,currentStatus:current?.status,minimumVersion:input.minimumVersion??manifest.minimumVersion??current?.minimumVersion??null,rollbackVersion:input.rollbackVersion??manifest.rollbackVersion??current?.rollbackVersion??null,createdAt:manifest.createdAt||current?.createdAt||now,candidateAt:current?.candidateAt||now,updatedAt:now,status:current?.status||"draft",publishedAt:current?.publishedAt||null,rollout:current?.rollout||(channel==="base"?"public":"internal")});
  await writeJson(metaPath(metadata.version),metadata);return metadata;
}

// Backward-compatible name: GitHub's old /publish endpoint now submits a draft candidate.
export const publishPanelRelease=submitPanelReleaseDraft;

export async function savePanelReleaseDraft(version:string,patch:PanelReleaseDraftPatch){
  const current=await readStoredMetadata(version);if(!current)throw new Error(`Panel release ${version} draft was not found`);if(current.status==="withdrawn")throw new Error("Withdrawn releases cannot be edited");
  const next:StoredPanelRelease={...current,updatedAt:new Date().toISOString()};
  if(patch.channel!==undefined){if(current.status!=="draft")throw new Error("Release channel can only be changed while draft");next.channel=normalizePanelReleaseChannel(patch.channel)}
  if(patch.title!==undefined)next.title=String(patch.title||"").trim()||`OrbitFS ${version}`;
  if(patch.description!==undefined)next.description=String(patch.description||"").trim();if(patch.changelog!==undefined)next.changelog=String(patch.changelog||"").trim();if(patch.customerNotes!==undefined)next.customerNotes=String(patch.customerNotes||"").trim();if(patch.internalNotes!==undefined)next.internalNotes=String(patch.internalNotes||"").trim();
  if(patch.severity!==undefined){if(!["normal","important","critical"].includes(String(patch.severity)))throw new Error("Invalid release severity");next.severity=patch.severity as PanelReleaseSeverity}if(patch.required!==undefined)next.required=Boolean(patch.required);
  if(patch.minimumVersion!==undefined)next.minimumVersion=normalizeNullableVersion(patch.minimumVersion);if(patch.rollbackVersion!==undefined)next.rollbackVersion=normalizeNullableVersion(patch.rollbackVersion);
  if(patch.rollout!==undefined){if(!["internal","beta","public"].includes(String(patch.rollout)))throw new Error("Invalid release rollout");next.rollout=patch.rollout as PanelReleaseRollout}if(patch.components!==undefined)next.components=normalizeComponents(patch.components);
  await writeJson(metaPath(version),next);return next;
}

export async function publishPanelReleaseDraft(version:string,patch:PanelReleaseDraftPatch={}){
  let current=await savePanelReleaseDraft(version,patch);if(current.status==="withdrawn")throw new Error("Withdrawn releases cannot be published");if(!current.title.trim())throw new Error("Release title is required");
  const previous=await latestPanelMetadata(current.channel).catch(()=>null);const now=new Date().toISOString();current={...current,status:"published",publishedAt:current.publishedAt||now,updatedAt:now};await writeJson(metaPath(version),current);await setChannelPointer(current.channel,version);
  if(current.channel==="base")await writeJson(LEGACY_LATEST_PATH,current);
  if(previous&&previous.version!==version){const prior=await readStoredMetadata(previous.version);if(prior&&prior.status==="published"){prior.status="superseded";prior.updatedAt=now;await writeJson(metaPath(prior.version),prior)}}
  return current;
}

export async function setPanelReleaseStatus(version:string,status:"paused"|"withdrawn"){
  const current=await readStoredMetadata(version);if(!current)throw new Error(`Panel release ${version} was not found`);current.status=status;current.updatedAt=new Date().toISOString();await writeJson(metaPath(version),current);
  const pointer=await readJson<any>(channelPath(current.channel));if(pointer?.version===version)await setChannelPointer(current.channel,null);return current;
}

function componentAllowed(components:any,code:string){let value=components?.[code];if(value===undefined&&Array.isArray(components))value=components.find((x:any)=>String(x?.code||x?.id||x?.component||"")===code);if(value===true)return true;if(!value||typeof value!=="object")return false;if(value.allowed===true||value.active===true||value.enabled===true||value.licensed===true)return true;const state=String(value.state||value.status||value.reason||"").toLowerCase();return ["active","enabled","licensed","included","ok"].includes(state)}
export async function authorizePanelRelease(input:any){const licenseKey=String(input?.licenseKey||input?.license_key||"").trim(),installationId=String(input?.installationId||input?.installation_id||"").trim();if(!licenseKey||!installationId)return {ok:false as const,status:400,error:"Licence key and installation id are required",code:"PANEL_RELEASE_IDENTITY_REQUIRED"};const settings=await runtimeLicenseSettings();if(!settings?.enabled)return {ok:false as const,status:503,error:"Website licence API is disabled",code:"LICENSE_API_DISABLED"};if(settings?.mode==="standby")return {ok:false as const,status:503,error:"Website licence API is in standby mode",code:"LICENSE_API_STANDBY"};const {data,error}=await licenseDb().rpc("website_license_validate",{p_license_key:licenseKey,p_installation_id:installationId,p_components:null,p_activate:false,p_device_name:input?.deviceName||null,p_platform:input?.platform||null,p_app_version:input?.appVersion||null});if(error)return {ok:false as const,status:400,error:error.message,code:"LICENSE_VALIDATION_ERROR"};if(data?.reason==="license_not_found")return {ok:false as const,status:404,error:"Licence not found",code:"LICENSE_NOT_FOUND"};if(data?.valid!==true)return {ok:false as const,status:403,error:"Licence is not valid for this installation",code:"PANEL_RELEASE_LICENSE_INVALID"};if(!componentAllowed(data?.components||{},PANEL_COMPONENT))return {ok:false as const,status:403,error:"This licence does not include OrbitFS Base access",code:"PANEL_RELEASE_NOT_ENTITLED"};return {ok:true as const,installationId,entitledComponent:PANEL_COMPONENT}}

export async function latestPanelMetadata(channel:PanelReleaseChannel="base"){
  const pointer=await readJson<any>(channelPath(channel));
  if(pointer){if(!pointer.version)throw new Error(`No published OrbitFS ${channel} release is currently available`);const current=await readStoredMetadata(String(pointer.version));if(!current||current.status!=="published")throw new Error(`No published OrbitFS ${channel} release is currently available`);return current}
  if(channel==="base"){const legacy=await readJson<any>(LEGACY_LATEST_PATH);if(legacy?.objectPath&&legacy?.version&&legacy?.sha256)return normalizeStored(legacy,{channel:"base",status:"published",rollout:"public"})}
  throw new Error(`No OrbitFS ${channel} release has been published yet`);
}

export async function getPanelRelease(version="latest"){
  const requested=String(version||"latest"),channel:PanelReleaseChannel=requested==="latest-update"?"update":"base";let metadata:StoredPanelRelease|undefined;let objectPath:string;
  if(requested==="latest"||requested==="latest-base"||requested==="latest-update"){metadata=await latestPanelMetadata(channel);objectPath=metadata.objectPath}else{if(!validVersion(requested))throw new Error("Panel release version is invalid");metadata=await readStoredMetadata(requested)||undefined;if(metadata&&!(["published","superseded"].includes(metadata.status)))throw new Error(`OrbitFS Panel release ${requested} is not published`);objectPath=metadata?.objectPath||`panel/${requested}/release.json.gz`}
  const db=await ensureReleaseBucket(),d=await db.storage.from(BUCKET).download(objectPath);if(d.error||!d.data)throw new Error(`OrbitFS Panel release ${requested} was not found`);const bytes=Buffer.from(await d.data.arrayBuffer()),{manifest,sha256}=inspectPanelRelease(bytes,requested.startsWith("latest")?"":requested);
  if(!metadata)metadata=normalizeStored({version:manifest.version,releaseId:String(manifest.releaseId||`panel-${manifest.version}`),sourceCommit:manifest.sourceCommit||null,schemaVersion:String(manifest.schemaVersion||"1"),sha256,size:bytes.length,fileCount:manifest.files.length,objectPath,projectSettings:manifest.projectSettings||{},channel:"base",status:"published",createdAt:manifest.createdAt,publishedAt:manifest.createdAt,components:manifest.components||["core"]});
  if(metadata.sha256!==sha256)throw new Error("Stored Panel release checksum is invalid");return {metadata,manifest,bytes};
}

export async function listPanelReleases(){
  const db=await ensureReleaseBucket(),root=await db.storage.from(BUCKET).list(META_DIR,{limit:100,sortBy:{column:"name",order:"desc"}});if(root.error)throw root.error;const out:StoredPanelRelease[]=[];
  for(const file of root.data||[]){if(!String(file.name||"").endsWith(".json"))continue;const version=String(file.name).slice(0,-5),r=await readStoredMetadata(version);if(r)out.push(r)}
  const legacy=await readJson<any>(LEGACY_LATEST_PATH);if(legacy?.version&&!out.some(x=>x.version===legacy.version))out.push(normalizeStored(legacy,{channel:"base",status:"published",rollout:"public"}));
  return out.sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
}

export async function latestPanelRelease(channel:PanelReleaseChannel="base"){const metadata=await latestPanelMetadata(channel),db=await ensureReleaseBucket(),signed=await db.storage.from(BUCKET).createSignedUrl(metadata.objectPath,DOWNLOAD_SECONDS,{download:true});if(signed.error||!signed.data?.signedUrl)throw signed.error||new Error("Could not create Panel release download URL");return {...metadata,downloadUrl:signed.data.signedUrl,expiresIn:DOWNLOAD_SECONDS}}
