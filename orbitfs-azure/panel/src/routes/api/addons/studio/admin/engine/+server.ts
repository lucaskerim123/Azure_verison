import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertComponentLicensed } from '$lib/server/component-license';
import { studioEngineState } from '$lib/server/studio-cloud';
const fail=(e:any)=>json({error:String(e?.message||'Studio engine request failed')},{status:Number(e?.status||500)});
export async function GET({cookies}:any){try{await requireAdmin(cookies);await assertComponentLicensed('orbitfs_studio');return json({engine:studioEngineState()});}catch(e){return fail(e);}}
export async function POST({request,cookies}:any){try{await requireAdmin(cookies);await assertComponentLicensed('orbitfs_studio');const input=await request.json().catch(()=>({}));const action=String(input.action||'status').toLowerCase();if(action==='status'||action==='refresh')return json({ok:true,action,engine:studioEngineState()});return json({error:`Studio cannot be ${action}ed as a resident service in Vercel serverless mode.`,action,engine:studioEngineState(),note:'Standby is the normal ready state in cloud mode. Analysis runs execute on demand.'},{status:409});}catch(e){return fail(e);}}
