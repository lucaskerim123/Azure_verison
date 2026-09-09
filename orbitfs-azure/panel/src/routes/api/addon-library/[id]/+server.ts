import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { isSystemAdmin } from '$lib/server/workspaces';
import { CLOUD_ADDON_MANIFESTS, getCloudAddon, presentAddon, saveCloudAddon } from '$lib/server/cloud-addons';
import { writeAudit } from '$lib/server/audit';

const fail=(e:any)=>json({error:String(e?.message||'Request failed'),code:String(e?.code||'ADDON_LIBRARY_ITEM_ERROR')},{status:Number(e?.status||500)});
const defaultEngineMode=(id:string)=>id==='mcp'?'running':'standby';

async function context(cookies:any){
  const user=await requireUser(cookies);
  await assertPanelLicensed();
  if(!isSystemAdmin(user)) throw Object.assign(new Error('System Owner or Admin required'),{status:403,code:'ADMIN_REQUIRED'});
  return user;
}

export async function GET({params,cookies}:any){
  try{
    await context(cookies);
    const id=String(params.id||'').trim().toLowerCase();
    return json({addon:await presentAddon(await getCloudAddon(id))});
  }catch(e){return fail(e);}
}

export async function DELETE({params,cookies}:any){
  try{
    const user=await context(cookies);
    const id=String(params.id||'').trim().toLowerCase();
    const row=await getCloudAddon(id);
    if(!row.updated_at||row.installed!==true) return json({ok:true,preservedData:true,addon:await presentAddon(row)});
    if(row.attached===true) throw Object.assign(new Error('Unlink the add-on from Engine before uninstalling it'),{status:409,code:'ADDON_ATTACHED'});
    const manifest=CLOUD_ADDON_MANIFESTS[id];
    if(!manifest) throw Object.assign(new Error('Add-on not found'),{status:404,code:'ADDON_NOT_FOUND'});
    const addon=await saveCloudAddon(id,{installed:false,attached:false,configured:false,status:'registered',deployment_url:null,config:{},runtime:{mode:manifest.runtimeMode||'engine-host',engineMode:defaultEngineMode(id),setupState:'not_started',compute:'vercel',database:'shared-panel',online:false}});
    await writeAudit({actorUserId:user.id,action:'addon.uninstall',targetType:'addon',targetId:id,detail:{preservedData:true,libraryApi:true}});
    return json({ok:true,preservedData:true,addon});
  }catch(e){return fail(e);}
}
