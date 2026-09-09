import {licenseDb} from "@/lib/license-api";
import {engineReleaseMetadata,publishEngineReleaseDraft,type StoredEngineRelease} from "@/lib/engine-release";
import {listPanelReleases,publishPanelReleaseDraft,type StoredPanelRelease} from "@/lib/panel-release";

export type OrbitfsReleaseBundleChannel="base"|"update";
export type OrbitfsReleaseBundleStatus="draft"|"published"|"paused"|"superseded"|"withdrawn"|"failed";

export type OrbitfsArtifactSnapshot={
  kind:"panel"|"engine";
  version:string;
  releaseId:string;
  sha256:string;
  size:number;
  fileCount:number;
  sourceCommit:string|null;
  schemaVersion?:string;
  components?:string[];
  checkpointRequired?:boolean;
  minimumEngineDeployerProtocol?:number;
};

export type OrbitfsReleaseBundle={
  id:string;version:string;channel:OrbitfsReleaseBundleChannel;status:OrbitfsReleaseBundleStatus;
  title:string;description:string;changelog:string;customerNotes:string;internalNotes:string;
  severity:"normal"|"important"|"critical";required:boolean;rollout:"internal"|"beta"|"public";
  minimumVersion:string|null;rollbackVersion:string|null;schemaVersion:string;checkpointRequired:boolean;components:string[];
  panelArtifact:OrbitfsArtifactSnapshot|null;engineArtifact:OrbitfsArtifactSnapshot|null;
  baseSourceCommit:string|null;engineSourceCommit:string|null;
  engineDeployerProtocol:number;minimumEngineDeployerProtocol:number;
  technicalAnalysis:Record<string,unknown>;metadata:Record<string,unknown>;
  createdAt:string;updatedAt:string;publishedAt:string|null;
};

const ENGINE_COMPONENTS=new Set(["addons","engine","apex","mcp","studio","orbitfs_apex","orbitfs_mcp","orbitfs_studio"]);
const cleanComponents=(value:any)=>[...new Set((Array.isArray(value)?value:[]).map(x=>String(x||"").trim().toLowerCase()).filter(Boolean))];

function rowToBundle(row:any):OrbitfsReleaseBundle{
  return {
    id:String(row.id),version:String(row.version),channel:row.channel,status:row.status,
    title:String(row.title||""),description:String(row.description||""),changelog:String(row.changelog||""),customerNotes:String(row.customer_notes||""),internalNotes:String(row.internal_notes||""),severity:row.severity||"normal",required:row.required===true,rollout:row.rollout||"public",
    minimumVersion:row.minimum_version||null,rollbackVersion:row.rollback_version||null,schemaVersion:String(row.schema_version||"1"),checkpointRequired:row.checkpoint_required===true,components:cleanComponents(row.components),
    panelArtifact:row.panel_artifact||null,engineArtifact:row.engine_artifact||null,baseSourceCommit:row.base_source_commit||null,engineSourceCommit:row.engine_source_commit||null,
    engineDeployerProtocol:Math.max(1,Number(row.engine_deployer_protocol||1)),minimumEngineDeployerProtocol:Math.max(1,Number(row.minimum_engine_deployer_protocol||1)),technicalAnalysis:row.technical_analysis||{},metadata:row.metadata||{},
    createdAt:String(row.created_at),updatedAt:String(row.updated_at),publishedAt:row.published_at?String(row.published_at):null
  };
}

function panelSnapshot(panel:StoredPanelRelease):OrbitfsArtifactSnapshot{
  return {kind:"panel",version:panel.version,releaseId:panel.releaseId,sha256:panel.sha256,size:panel.size,fileCount:panel.fileCount,sourceCommit:panel.sourceCommit||null,schemaVersion:String(panel.schemaVersion||"1")};
}
function engineSnapshot(engine:StoredEngineRelease):OrbitfsArtifactSnapshot{
  return {kind:"engine",version:engine.version,releaseId:engine.releaseId,sha256:engine.sha256,size:engine.size,fileCount:engine.fileCount,sourceCommit:engine.sourceCommit||null,components:engine.components||[],checkpointRequired:engine.checkpointRequired,minimumEngineDeployerProtocol:Math.max(1,Number(engine.minimumEngineDeployerProtocol||1))};
}

export async function listOrbitfsReleaseBundles(limit=100){
  const {data,error}=await licenseDb().from("orbitfs_release_bundles").select("*").order("updated_at",{ascending:false}).limit(Math.min(250,Math.max(1,limit)));
  if(error)throw error;return (data||[]).map(rowToBundle);
}
export async function getOrbitfsReleaseBundle(version:string){
  const {data,error}=await licenseDb().from("orbitfs_release_bundles").select("*").eq("version",version).maybeSingle();
  if(error)throw error;return data?rowToBundle(data):null;
}

async function latestKnownDeployerProtocol(){
  const {data,error}=await licenseDb().from("orbitfs_release_bundles").select("engine_deployer_protocol,published_at").in("status",["published","superseded"]).not("panel_artifact","is",null).order("published_at",{ascending:false,nullsFirst:false}).limit(1);
  if(error)throw error;return Math.max(1,Number((data||[])[0]?.engine_deployer_protocol||1));
}

export async function syncOrbitfsReleaseBundle(input:{panel?:StoredPanelRelease|null;engine?:StoredEngineRelease|null;components?:string[];minimumEngineDeployerProtocol?:number;engineDeployerProtocol?:number;technicalAnalysis?:Record<string,unknown>}){
  const panel=input.panel||null,engine=input.engine||null;
  if(!panel&&!engine)throw new Error("A release bundle requires at least one artifact candidate");
  const version=String(panel?.version||engine?.version||"");
  if(panel&&engine&&panel.version!==engine.version)throw new Error("Panel and Engine candidates must use the same OrbitFS version");
  const existing=await getOrbitfsReleaseBundle(version);
  const channel=(panel?.channel||existing?.channel||"update") as OrbitfsReleaseBundleChannel;
  const componentSource=panel?.components?.length
    ? panel.components
    : existing?.panelArtifact&&existing.components.length
      ? existing.components
      : input.components?.length
        ? input.components
        : engine?.components?.length
          ? engine.components
          : existing?.components||[];
  const components=cleanComponents(componentSource);
  const inheritedProtocol=existing?.engineDeployerProtocol||await latestKnownDeployerProtocol().catch(()=>1);
  const engineDeployerProtocol=Math.max(1,Number(input.engineDeployerProtocol||inheritedProtocol||1));
  const minimumEngineDeployerProtocol=Math.max(1,Number(input.minimumEngineDeployerProtocol||engine?.minimumEngineDeployerProtocol||existing?.minimumEngineDeployerProtocol||1));
  const row:any={
    version,channel,status:existing?.status||"draft",title:panel?.title||existing?.title||`OrbitFS ${version}`,
    description:panel?.description??existing?.description??"",changelog:panel?.changelog??existing?.changelog??"",customer_notes:panel?.customerNotes??existing?.customerNotes??"",internal_notes:panel?.internalNotes??existing?.internalNotes??"",
    severity:panel?.severity||existing?.severity||"normal",required:panel?.required??existing?.required??false,rollout:panel?.rollout||existing?.rollout||"public",
    minimum_version:panel?.minimumVersion??existing?.minimumVersion??null,rollback_version:panel?.rollbackVersion??existing?.rollbackVersion??null,schema_version:String(panel?.schemaVersion||existing?.schemaVersion||"1"),
    checkpoint_required:channel==="update",components:channel==="base"?["core"]:components,
    panel_artifact:panel?panelSnapshot(panel):(existing?.panelArtifact||null),engine_artifact:engine?engineSnapshot(engine):(existing?.engineArtifact||null),
    base_source_commit:panel?.sourceCommit||existing?.baseSourceCommit||null,engine_source_commit:engine?.sourceCommit||existing?.engineSourceCommit||null,
    engine_deployer_protocol:engineDeployerProtocol,minimum_engine_deployer_protocol:minimumEngineDeployerProtocol,
    technical_analysis:input.technicalAnalysis||existing?.technicalAnalysis||{},metadata:existing?.metadata||{},updated_at:new Date().toISOString()
  };
  const {data,error}=await licenseDb().from("orbitfs_release_bundles").upsert(row,{onConflict:"version"}).select("*").single();
  if(error)throw error;return rowToBundle(data);
}

export function validateOrbitfsReleaseBundle(bundle:OrbitfsReleaseBundle){
  if(!bundle.panelArtifact&&!bundle.engineArtifact)throw new Error("Release bundle has no deployable artifacts");
  if(bundle.channel==="base"){
    if(!bundle.panelArtifact)throw new Error("BASE releases require a Panel/Base artifact");
    if(bundle.engineArtifact)throw new Error("BASE releases cannot include an Engine artifact");
    if(bundle.checkpointRequired)throw new Error("BASE releases cannot require an update checkpoint");
  }else if(!bundle.checkpointRequired)throw new Error("UPDATE releases must require an update checkpoint");
  const needsEngine=bundle.components.some(x=>ENGINE_COMPONENTS.has(x));
  if(needsEngine&&!bundle.engineArtifact)throw new Error("Release components require an Engine artifact, but none is attached");
  if(bundle.engineArtifact&&bundle.engineArtifact.checkpointRequired===false)throw new Error("Engine UPDATE artifact does not require a checkpoint");
  if(bundle.engineArtifact&&bundle.minimumEngineDeployerProtocol<1)throw new Error("Engine deployer protocol requirement is invalid");
  if(bundle.engineArtifact&&bundle.engineDeployerProtocol<bundle.minimumEngineDeployerProtocol)throw new Error(`Available Engine Deployer protocol ${bundle.engineDeployerProtocol} cannot deploy Engine artifact requiring protocol ${bundle.minimumEngineDeployerProtocol}. Include a compatible Panel/Base artifact first.`);
  if(bundle.panelArtifact&&bundle.panelArtifact.version!==bundle.version)throw new Error("Panel artifact version does not match release bundle");
  if(bundle.engineArtifact&&bundle.engineArtifact.version!==bundle.version)throw new Error("Engine artifact version does not match release bundle");
  return bundle;
}

async function assertArtifactCandidates(bundle:OrbitfsReleaseBundle){
  let panel:StoredPanelRelease|null=null,engine:StoredEngineRelease|null=null;
  if(bundle.panelArtifact){
    panel=(await listPanelReleases()).find(r=>r.version===bundle.version)||null;
    if(!panel||panel.sha256!==bundle.panelArtifact.sha256||panel.sourceCommit!==bundle.panelArtifact.sourceCommit)throw new Error("Panel candidate no longer matches the immutable bundle snapshot");
    if(panel.status==="withdrawn")throw new Error("Panel candidate is withdrawn");
  }
  if(bundle.engineArtifact){
    engine=await engineReleaseMetadata(bundle.version);
    if(!engine||engine.sha256!==bundle.engineArtifact.sha256||engine.sourceCommit!==bundle.engineArtifact.sourceCommit)throw new Error("Engine candidate no longer matches the immutable bundle snapshot");
    if(engine.status==="withdrawn")throw new Error("Engine candidate is withdrawn");
    if(engine.minimumEngineDeployerProtocol!==bundle.minimumEngineDeployerProtocol)throw new Error("Engine deployer protocol requirement changed after the bundle was created");
  }
  return {panel,engine};
}

export async function publishOrbitfsReleaseBundle(version:string){
  const current=await getOrbitfsReleaseBundle(version);if(!current)throw new Error(`OrbitFS release bundle ${version} was not found`);
  if(current.status==="withdrawn")throw new Error("Withdrawn OrbitFS release bundles cannot be published");
  validateOrbitfsReleaseBundle(current);
  const db=licenseDb(),now=new Date().toISOString();
  await db.from("orbitfs_release_bundles").update({status:"superseded",updated_at:now}).eq("channel",current.channel).eq("status","published").neq("version",version);
  const {data,error}=await db.from("orbitfs_release_bundles").update({status:"published",published_at:current.publishedAt||now,updated_at:now}).eq("version",version).select("*").single();
  if(error)throw error;return rowToBundle(data);
}

export async function publishOrbitfsReleaseBundleArtifacts(version:string){
  let bundle=await getOrbitfsReleaseBundle(version);if(!bundle)throw new Error(`OrbitFS release bundle ${version} was not found`);
  validateOrbitfsReleaseBundle(bundle);
  const {panel,engine}=await assertArtifactCandidates(bundle);
  let publishedPanel:StoredPanelRelease|null=panel,publishedEngine:StoredEngineRelease|null=engine;
  if(panel)publishedPanel=await publishPanelReleaseDraft(version,{});
  if(engine)publishedEngine=await publishEngineReleaseDraft(version);
  bundle=await syncOrbitfsReleaseBundle({panel:publishedPanel,engine:publishedEngine,components:bundle.components,engineDeployerProtocol:bundle.engineDeployerProtocol,minimumEngineDeployerProtocol:bundle.minimumEngineDeployerProtocol,technicalAnalysis:bundle.technicalAnalysis});
  return {bundle:await publishOrbitfsReleaseBundle(version),panel:publishedPanel,engine:publishedEngine};
}

export async function setOrbitfsReleaseBundleStatus(version:string,status:"paused"|"withdrawn"|"failed"){
  const current=await getOrbitfsReleaseBundle(version);if(!current)throw new Error(`OrbitFS release bundle ${version} was not found`);
  const {data,error}=await licenseDb().from("orbitfs_release_bundles").update({status,updated_at:new Date().toISOString()}).eq("version",version).select("*").single();
  if(error)throw error;return rowToBundle(data);
}
