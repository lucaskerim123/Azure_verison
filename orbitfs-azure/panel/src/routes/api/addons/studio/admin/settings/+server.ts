import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertComponentLicensed } from '$lib/server/component-license';
import { getStudioAdminSettings,updateStudioAdminSettings } from '$lib/server/studio-cloud';
const fail=(e:any)=>json({error:String(e?.message||'Studio settings request failed'),code:String(e?.code||'STUDIO_SETTINGS_ERROR')},{status:Number(e?.status||500)});
export async function GET({cookies}:any){try{const user=await requireAdmin(cookies);await assertComponentLicensed('orbitfs_studio');return json(await getStudioAdminSettings(user));}catch(e){return fail(e);}}
export async function PATCH({request,cookies}:any){try{const user=await requireAdmin(cookies);await assertComponentLicensed('orbitfs_studio');const input=await request.json().catch(()=>({}));return json(await updateStudioAdminSettings(user,input));}catch(e){return fail(e);}}
