import {createHash,timingSafeEqual} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {licenseDb,runtimeLicenseSettings} from "@/lib/license-api";

const BUCKET="orbitfs-engine-releases";
const LEGACY_LATEST_PATH="engine/latest.json";
const META_DIR="engine/meta";
const MAX_RELEASE_BYTES=25*1024*1024;
const DOWNLOAD_SECONDS=300;
const ENGINE_COMPONENTS=["orbitfs_mcp","orbitfs_apex","orbitfs_studio"] as const;
const ENGINE_PACKAGE_COMPONENTS=new Set(["apex","mcp","studio"]);

export type EngineReleaseManifest={
  format:"orbitfs-engine-release-v1";
  version:string;
  releaseId:string;
  sourceCommit:string|null;
  createdAt:string;
  components?:string[];
  checkpointRequired?:boolean;
  minimumEngineDeployerProtocol?:number;
  projectSettings:{framework?:string;buildCommand?:string;installCommand?:string;outputDirectory?:string};
  files:Array<{file:string;data:string;encoding:"base64"|"utf-8";size?:number}>;
};
export type EngineReleaseStatus="draft"|"published"|"superseded"|"paused"|"withdrawn";
export type StoredEngineRelease={version:string;releaseId:string;sourceCommit:string|null;sha256:string;size:number;fileCount:number;objectPath:string;projectSettings:EngineReleaseManifest["projectSettings"];components:string[];checkpointRequired:boolean;minimumEngineDeployerProtocol:number;status:EngineReleaseStatus;createdAt:string;candidateAt:string;publishedAt:string|null;updatedAt:string};

function safeEqual(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)}
function validVersion(value:string){return /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(String(value||""))}
function metaPath(version:string){return `${META_DIR}/${version}.json`}
function normalizeEngineComponents(value:any){return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x||"").trim().toLowerCase()).filter(x=>ENGINE_PACKAGE_COMPONENTS.has(x)))].slice(0,3)}

export async function authorizeReleasePublisher(req:Request){
  const supplied=String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();let expected="";
  try{const {data}=await licenseDb().rpc("service_orbitfs_release_secret",{p_key:"engine_publish_token"});expected=String(data||"").trim()}catch{}
  if(!expected)expected=String(process.env.ORBITFS_ENGINE_RELEASE_PUBLISH_TOKEN||"").trim();
  if(!expected)return {ok:false as const,status:503,error:"Engine release publishing is not configured",code:"ENGINE_RELEASE_PUBLISH_NOT_CONFIGURED"};
  if(!supplied||!safeEqual(supplied,expected))return {ok:false as const,status:401,error:"Invalid release publisher token",code:"ENGINE_RELEASE_PUBLISH_UNAUTHORIZED"};
  return {ok:true as const};
}
function safeReleasePath(path:string){const p=String(path||"").trim().replace(/\\/g,"/");return !!p&&!p.startsWith("/")&&!p.startsWith("../")&&!p.includes("/../")&&!p.includes("\0")}
export function inspectEngineRelease(bytes:Buffer,expectedVersion=""){
  if(!bytes.length||bytes.length>MAX_RELEASE_BYTES)throw new Error("Engine release package size is invalid");
  const sha256=createHash("sha256").update(bytes).digest("hex"),decoded=gunzipSync(bytes,{maxOutputLength:75*1024*1024}),manifest=JSON.parse(decoded.toString("utf8")) as EngineReleaseManifest;
  if(manifest?.format!=="orbitfs-engine-release-v1")throw new Error("Unsupported Engine release format");
  if(!validVersion(manifest.version))throw new Error("Engine release version is invalid");
  if(expectedVersion&&manifest.version!==expectedVersion)throw new Error("Engine release version header does not match package");
  const components=normalizeEngineComponents(manifest.components);
  if(!components.length)throw new Error("Engine release must identify at least one Engine component");
  manifest.components=components;
  if(manifest.checkpointRequired!==true)throw new Error("Engine UPDATE releases must require an OrbitFS update checkpoint");
  const minimumEngineDeployerProtocol=Number(manifest.minimumEngineDeployerProtocol||1);
  if(!Number.isInteger(minimumEngineDeployerProtocol)||minimumEngineDeployerProtocol<1||minimumEngineDeployerProtocol>100)throw new Error("Engine release deployer protocol requirement is invalid");
  manifest.minimumEngineDeployerProtocol=minimumEngineDeployerProtocol;
  if(!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>2000)throw new Error("Engine release file list is invalid");
  const seen=new Set<string>();
  for(const file of manifest.files){if(!safeReleasePath(file.file)||seen.has(file.file))throw new Error(`Unsafe or duplicate Engine release path: ${file.file}`);seen.add(file.file);if(!["base64","utf-8"].includes(file.encoding))throw new Error(`Unsupported Engine release encoding for ${file.file}`);if(typeof file.data!=="string")throw new Error(`Engine release file data is invalid for ${file.file}`)}
  if(!seen.has("package.json")||![...seen].some(p=>p.startsWith("src/")))throw new Error("Engine release is missing required project files");
  return {manifest,sha256};
}
async function ensureReleaseBucket(){const db=licenseDb(),current=await db.storage.getBucket(BUCKET);if(current.data)return db;const created=await db.storage.createBucket(BUCKET,{public:false,fileSizeLimit:MAX_RELEASE_BYTES});if(created.error&&!String(created.error.message||"").toLowerCase().includes("already"))throw created.error;return db}
async function readJson<T>(path:string):Promise<T|null>{const db=await ensureReleaseBucket(),d=await db.storage.from(BUCKET).download(path);if(d.error||!d.data)return null;try{return JSON.parse(await d.data.text()) as T}catch{return null}}
async function writeJson(path:string,value:any){const db=await ensureReleaseBucket(),u=await db.storage.from(BUCKET).upload(path,Buffer.from(JSON.stringify(value)),{contentType:"application/json",upsert:true,cacheControl:"0"});if(u.error)throw u.error}
function normalizeStored(value:any):StoredEngineRelease{const now=new Date().toISOString();return {version:String(value?.version||""),releaseId:String(value?.releaseId||`engine-${value?.version||"unknown"}`),sourceCommit:String(value?.sourceCommit||"").trim()||null,sha256:String(value?.sha256||""),size:Number(value?.size||0),fileCount:Number(value?.fileCount||0),objectPath:String(value?.objectPath||""),projectSettings:value?.projectSettings||{},components:normalizeEngineComponents(value?.components),checkpointRequired:value?.checkpointRequired!==false,minimumEngineDeployerProtocol:Math.max(1,Number(value?.minimumEngineDeployerProtocol||1)),status:(value?.status||"published") as EngineReleaseStatus,createdAt:String(value?.createdAt||value?.publishedAt||now),candidateAt:String(value?.candidateAt||value?.publishedAt||now),publishedAt:value?.publishedAt?String(value.publishedAt):null,updatedAt:String(value?.updatedAt||value?.publishedAt||now)}}
export async function engineReleaseMetadata(version:string){if(!validVersion(version))return null;const stored=await readJson<StoredEngineRelease>(metaPath(version));if(stored)return normalizeStored(stored);const legacy=await readJson<any>(LEGACY_LATEST_PATH);return legacy?.version===version?normalizeStored({...legacy,status:"published"}):null}

export async function submitEngineReleaseDraft(bytes:Buffer,input:{version:string;sha256?:string|null;sourceCommit?:string|null}){
  const {manifest,sha256}=inspectEngineRelease(bytes,input.version);if(input.sha256&&String(input.sha256).toLowerCase()!==sha256)throw new Error("Engine release checksum header does not match package");const db=await ensureReleaseBucket(),objectPath=`engine/${manifest.version}/release.json.gz`,existing=await db.storage.from(BUCKET).download(objectPath);
  if(existing.data&&!existing.error){const existingBytes=Buffer.from(await existing.data.arrayBuffer()),existingSha=createHash("sha256").update(existingBytes).digest("hex");if(existingSha!==sha256)throw new Error("Engine release version already exists with a different checksum; publish a new version")}else{const uploaded=await db.storage.from(BUCKET).upload(objectPath,bytes,{contentType:"application/gzip",upsert:false,cacheControl:"31536000"});if(uploaded.error)throw uploaded.error}
  const current=await engineReleaseMetadata(manifest.version);if(current&&current.sha256&&current.sha256!==sha256)throw new Error("Stored Engine release metadata checksum does not match package");const now=new Date().toISOString(),metadata:StoredEngineRelease=normalizeStored({...current,version:manifest.version,releaseId:String(manifest.releaseId||`engine-${manifest.version}`),sourceCommit:String(input.sourceCommit||manifest.sourceCommit||"").trim()||null,sha256,size:bytes.length,fileCount:manifest.files.length,objectPath,projectSettings:manifest.projectSettings||{},components:manifest.components||[],checkpointRequired:true,minimumEngineDeployerProtocol:manifest.minimumEngineDeployerProtocol||1,status:current?.status||"draft",createdAt:manifest.createdAt||current?.createdAt||now,candidateAt:current?.candidateAt||now,publishedAt:current?.publishedAt||null,updatedAt:now});await writeJson(metaPath(metadata.version),metadata);return metadata;
}
export const publishEngineRelease=submitEngineReleaseDraft;

export async function publishEngineReleaseDraft(version:string){const current=await engineReleaseMetadata(version);if(!current)throw new Error(`Engine release ${version} draft was not found`);if(current.status==="withdrawn")throw new Error("Withdrawn Engine releases cannot be published");const previous=await latestEngineMetadata().catch(()=>null),now=new Date().toISOString(),next={...current,status:"published" as const,publishedAt:current.publishedAt||now,updatedAt:now};await writeJson(metaPath(version),next);await writeJson(LEGACY_LATEST_PATH,next);if(previous&&previous.version!==version){const prior=await engineReleaseMetadata(previous.version);if(prior&&prior.status==="published"){prior.status="superseded";prior.updatedAt=now;await writeJson(metaPath(prior.version),prior)}}return next}
export async function setEngineReleaseStatus(version:string,status:"paused"|"withdrawn"){const current=await engineReleaseMetadata(version);if(!current)throw new Error(`Engine release ${version} was not found`);current.status=status;current.updatedAt=new Date().toISOString();await writeJson(metaPath(version),current);return current}
export async function listEngineReleases(){const db=await ensureReleaseBucket(),root=await db.storage.from(BUCKET).list(META_DIR,{limit:100,sortBy:{column:"name",order:"desc"}});if(root.error)throw root.error;const out:StoredEngineRelease[]=[];for(const file of root.data||[]){if(!String(file.name||"").endsWith(".json"))continue;const r=await engineReleaseMetadata(String(file.name).slice(0,-5));if(r)out.push(r)}const legacy=await readJson<any>(LEGACY_LATEST_PATH);if(legacy?.version&&!out.some(x=>x.version===legacy.version))out.push(normalizeStored({...legacy,status:"published"}));return out.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
export async function latestEngineMetadata(){const metadata=await readJson<any>(LEGACY_LATEST_PATH);if(!metadata?.objectPath||!metadata?.version||!metadata?.sha256)throw new Error("No OrbitFS Engine release has been published yet");const current=await engineReleaseMetadata(String(metadata.version));if(current&&current.status!=="published")throw new Error("No published OrbitFS Engine release is currently available");return current||normalizeStored({...metadata,status:"published"})}

function componentAllowed(components:any,code:string){let value=components?.[code];if(value===undefined&&Array.isArray(components))value=components.find((x:any)=>String(x?.code||x?.id||x?.component||"")===code);if(value===true)return true;if(!value||typeof value!=="object")return false;if(value.allowed===true||value.active===true||value.enabled===true||value.licensed===true)return true;const state=String(value.state||value.status||value.reason||"").toLowerCase();return ["active","enabled","licensed","included","ok"].includes(state)}
export async function authorizeEngineRelease(input:any){const licenseKey=String(input?.licenseKey||input?.license_key||"").trim(),installationId=String(input?.installationId||input?.installation_id||"").trim();if(!licenseKey||!installationId)return {ok:false as const,status:400,error:"Licence key and installation id are required",code:"ENGINE_RELEASE_IDENTITY_REQUIRED"};const settings=await runtimeLicenseSettings();if(!settings?.enabled)return {ok:false as const,status:503,error:"Website licence API is disabled",code:"LICENSE_API_DISABLED"};if(settings?.mode==="standby")return {ok:false as const,status:503,error:"Website licence API is in standby mode",code:"LICENSE_API_STANDBY"};const {data,error}=await licenseDb().rpc("website_license_validate",{p_license_key:licenseKey,p_installation_id:installationId,p_components:null,p_activate:false,p_device_name:input?.deviceName||null,p_platform:input?.platform||null,p_app_version:input?.appVersion||null});if(error)return {ok:false as const,status:400,error:error.message,code:"LICENSE_VALIDATION_ERROR"};if(data?.reason==="license_not_found")return {ok:false as const,status:404,error:"Licence not found",code:"LICENSE_NOT_FOUND"};if(data?.valid!==true)return {ok:false as const,status:403,error:"Licence is not valid for this installation",code:"ENGINE_RELEASE_LICENSE_INVALID"};const entitled=ENGINE_COMPONENTS.filter(code=>componentAllowed(data?.components||{},code));if(!entitled.length)return {ok:false as const,status:403,error:"This licence does not include an OrbitFS Engine add-on",code:"ENGINE_RELEASE_NOT_ENTITLED"};return {ok:true as const,installationId,entitled}}
export async function latestEngineRelease(){const metadata=await latestEngineMetadata(),db=await ensureReleaseBucket(),signed=await db.storage.from(BUCKET).createSignedUrl(metadata.objectPath,DOWNLOAD_SECONDS,{download:true});if(signed.error||!signed.data?.signedUrl)throw signed.error||new Error("Could not create Engine release download URL");return {...metadata,downloadUrl:signed.data.signedUrl,expiresIn:DOWNLOAD_SECONDS}}
