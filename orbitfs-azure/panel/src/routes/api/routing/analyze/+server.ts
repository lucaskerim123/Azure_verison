import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { analyzeCloudRouting } from '$lib/server/routing-engine-cloud';

export async function POST({ request, cookies }:any){
  try{
    const user=await requireUser(cookies);await assertPanelLicensed();
    const input=await request.json().catch(()=>({}));
    const workspaceId=String(input.workspaceId||'').trim();
    if(!workspaceId)return json({error:'workspaceId is required'},{status:400});
    const analysis=await analyzeCloudRouting(user,workspaceId,input.entry||{},input.settings||{});
    return json(analysis);
  }catch(error:any){
    return json({error:String(error?.message||'Routing analysis failed'),code:String(error?.code||'ROUTING_ANALYSIS_FAILED')},{status:Number(error?.status||500)});
  }
}
