import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { isSystemAdmin } from '$lib/server/workspaces';
import { assertAddonLicensed, CLOUD_ADDON_MANIFESTS, ensureCloudAddonRecord, saveCloudAddon } from '$lib/server/cloud-addons';
import { getSharedEngineHostState } from '$lib/server/engine-host-state';
import { writeAudit } from '$lib/server/audit';

const fail=(e:any)=>json({error:String(e?.message||'Request failed'),code:String(e?.code||'ADDON_INSTALL_ERROR')},{status:Number(e?.status||500)});
const isEngineHostAddon=(id:string)=>CLOUD_ADDON_MANIFESTS[id]?.runtimeMode==='engine-host';
const defaultEngineMode=(id:string)=>id==='mcp'?'running':'standby';

export async function POST({params,cookies}:any){
	try{
		const user=await requireUser(cookies);
		await assertPanelLicensed();
		if(!isSystemAdmin(user))throw Object.assign(new Error('System Owner or Admin required'),{status:403,code:'ADMIN_REQUIRED'});
		const id=String(params.id||'').trim().toLowerCase();
		const manifest=CLOUD_ADDON_MANIFESTS[id];
		if(!manifest)throw Object.assign(new Error('Add-on not found'),{status:404,code:'ADDON_NOT_FOUND'});
		if(manifest.panelIntegration?.installable===false)throw Object.assign(new Error('This add-on is not currently installable'),{status:409,code:'ADDON_NOT_INSTALLABLE'});
		const row=await ensureCloudAddonRecord(id);
		if(row.available===false)throw Object.assign(new Error('This add-on is not currently available'),{status:409,code:'ADDON_UNAVAILABLE'});
		await assertAddonLicensed(manifest.licenseComponent||row.license_component||null,true);
		const engineHosted=isEngineHostAddon(id);
		const host=engineHosted?await getSharedEngineHostState():null;
		const previousMode=String(row.runtime?.engineMode||'');
		const runtime={
			...(row.runtime||{}),
			mode:engineHosted?'engine-host':'external-vercel',
			engineMode:id==='mcp'?(previousMode==='stopped'?'stopped':'running'):(previousMode||defaultEngineMode(id)),
			setupState:row.runtime?.setupState||'not_started',
			compute:'vercel',
			database:'shared-panel',
			online:false
		};
		const addon=await saveCloudAddon(row.id,{
			installed:true,
			attached:false,
			configured:false,
			status:'detached',
			installed_at:row.installed_at||new Date().toISOString(),
			deployment_url:engineHosted?host?.hostUrl:row.deployment_url,
			transport_path:row.transport_path??manifest.transportPath??null,
			runtime
		});
		await writeAudit({actorUserId:user.id,action:'addon.install',targetType:'addon',targetId:row.id,detail:{engineHost:engineHosted,libraryInstall:true}});
		return json({ok:true,addon,host});
	}catch(e){return fail(e);}
}
