import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { isSystemAdmin } from '$lib/server/workspaces';
import { assertAddonLicensed, CLOUD_ADDON_MANIFESTS, ensureCloudAddonRecord, getCloudAddon, presentAddon, saveCloudAddon } from '$lib/server/cloud-addons';
import { getEngineAttachContext } from '$lib/server/engine-host';
import { assertSharedEngineHostReady, getSharedEngineHostState } from '$lib/server/engine-host-state';
import { confirmEngineHostDetach, confirmEngineHostPairing, readRemoteEngineHostLink, readSharedEngineHostLink } from '$lib/server/engine-host-remote';
import { syncAllApexKnowledgeToMcp } from '$lib/server/apex-mcp-integration';
import { writeAudit } from '$lib/server/audit';

const fail=(e:any)=>json({error:String(e?.message||'Request failed'),code:String(e?.code||'ADDON_LIBRARY_ERROR')},{status:Number(e?.status||500)});
const defaultEngineMode=(id:string)=>id==='mcp'?'running':'standby';

async function context(cookies:any){
  const user=await requireUser(cookies);
  await assertPanelLicensed();
  if(!isSystemAdmin(user)) throw Object.assign(new Error('System Owner or Admin required'),{status:403,code:'ADMIN_REQUIRED'});
  return user;
}

export async function POST({params,cookies}:any){
  try{
    const user=await context(cookies);
    const id=String(params.id||'').trim().toLowerCase();
    const rawAction=String(params.action||'').trim().toLowerCase();
    const action=rawAction==='attach'?'link':rawAction==='detach'?'unlink':rawAction;
    const manifest=CLOUD_ADDON_MANIFESTS[id];
    if(!manifest) throw Object.assign(new Error('Add-on not found'),{status:404,code:'ADDON_NOT_FOUND'});

    if(action==='install'){
      if(manifest.panelIntegration?.installable===false) throw Object.assign(new Error('This add-on is not currently installable'),{status:409,code:'ADDON_NOT_INSTALLABLE'});
      const row=await ensureCloudAddonRecord(id);
      if(row.available===false) throw Object.assign(new Error('This add-on is not currently available'),{status:409,code:'ADDON_UNAVAILABLE'});
      await assertAddonLicensed(manifest.licenseComponent||row.license_component||null,true);
      const engineHosted=manifest.runtimeMode==='engine-host';
      const host=engineHosted?await getSharedEngineHostState():null;
      const previousMode=String(row.runtime?.engineMode||'');
      const runtime={...(row.runtime||{}),mode:engineHosted?'engine-host':'external-vercel',engineMode:id==='mcp'?(previousMode==='stopped'?'stopped':'running'):(previousMode||defaultEngineMode(id)),setupState:row.runtime?.setupState||'not_started',compute:'vercel',database:'shared-panel',online:false};
      const addon=await saveCloudAddon(id,{installed:true,attached:false,configured:false,status:'detached',installed_at:row.installed_at||new Date().toISOString(),deployment_url:engineHosted?host?.hostUrl:row.deployment_url,transport_path:row.transport_path??manifest.transportPath??null,runtime});
      await writeAudit({actorUserId:user.id,action:'addon.install',targetType:'addon',targetId:id,detail:{libraryApi:true}});
      return json({ok:true,addon,host});
    }

    let row=await getCloudAddon(id);
    if(!row.updated_at||row.installed!==true) throw Object.assign(new Error('Install the add-on first'),{status:409,code:'ADDON_NOT_INSTALLED'});

    if(action==='link'){
      if(row.available===false||manifest.panelIntegration?.installable===false) throw Object.assign(new Error('This add-on is not currently available to link'),{status:409,code:'ADDON_NOT_AVAILABLE'});
      await assertAddonLicensed(row.license_component||manifest.licenseComponent,true);
      if(manifest.runtimeMode!=='engine-host') throw Object.assign(new Error('This add-on does not use the shared Engine Host'),{status:409,code:'ENGINE_HOST_NOT_SUPPORTED'});
      const host=await assertSharedEngineHostReady();
      const attach=await getEngineAttachContext(id,String(user.id));
      const remote=await confirmEngineHostPairing({engineId:id,installationId:attach.installationId,panelUrl:attach.panelUrl,workspaceId:attach.workspaceId,actorUserId:String(user.id)});
      const reconcile=id==='mcp'||id==='apex';
      const knowledgeSync=reconcile?await syncAllApexKnowledgeToMcp().catch((error:any)=>({available:true,synced:0,failed:1,error:String(error?.message||error||'Knowledge reconciliation failed')})):null;
      await writeAudit({actorUserId:user.id,action:'engine.attach',targetType:'addon',targetId:id,detail:{engineHost:host.hostUrl,libraryApi:true}});
      return json({ok:true,addon:await presentAddon(await getCloudAddon(id)),engineHost:remote,...(reconcile?{knowledgeSync}:{})});
    }

    if(action==='unlink'){
      if(manifest.runtimeMode!=='engine-host') throw Object.assign(new Error('This add-on does not use the shared Engine Host'),{status:409,code:'ENGINE_HOST_NOT_SUPPORTED'});
      await assertSharedEngineHostReady();
      const remote=await confirmEngineHostDetach(id,String(user.id));
      await writeAudit({actorUserId:user.id,action:'engine.detach',targetType:'addon',targetId:id,detail:{libraryApi:true}});
      return json({ok:true,addon:await presentAddon(await getCloudAddon(id)),engineHost:remote});
    }

    if(action==='test'){
      await assertAddonLicensed(row.license_component||manifest.licenseComponent,false);
      await assertSharedEngineHostReady();
      const [remote,host]=await Promise.all([readRemoteEngineHostLink(id),readSharedEngineHostLink()]);
      row=await getCloudAddon(id);
      await saveCloudAddon(id,{runtime:{...(row.runtime||{}),lastTestedAt:new Date().toISOString(),engineHostReachable:true,httpStatus:200,compute:'vercel',database:'shared-panel'}});
      return json({ok:true,online:true,httpStatus:200,host,state:remote});
    }

    throw Object.assign(new Error('Add-on Library action not found'),{status:404,code:'ADDON_ACTION_NOT_FOUND'});
  }catch(e){return fail(e);}
}
