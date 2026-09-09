import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { isSystemAdmin } from '$lib/server/workspaces';

const fail=(e:any)=>json({error:String(e?.message||'Could not respond to ownership request')},{status:Number(e?.status||500)});
export async function POST({params,request,cookies}:any){
  try{
    const user=await requireUser(cookies);await assertPanelLicensed();
    const parts=String(params.rest||'').split('/').filter(Boolean),requestId=parts[0],action=parts[1];
    if(!requestId||!['respond','target-respond'].includes(action))return json({error:'Not found'},{status:404});
    const body=await request.json().catch(()=>({})),db=getSupabaseAdmin();
    const found=await db.from('orbitfs_workspace_requests').select('*').eq('id',requestId).eq('request_type','ownership').maybeSingle();
    if(found.error)throw found.error;if(!found.data)throw Object.assign(new Error('Request not found'),{status:404});
    const row:any=found.data,payload:any=row.payload||{},now=new Date().toISOString();
    if(action==='respond'){
      if(!isSystemAdmin(user))throw Object.assign(new Error('System Owner or Admin required'),{status:403});
      if(!['pending','admin_pending'].includes(row.status))throw Object.assign(new Error('Request is not awaiting admin approval'),{status:409});
      if(body.decision!=='approved'){
        const denied=await db.from('orbitfs_workspace_requests').update({status:'denied',decided_by_id:user.id,decided_at:now}).eq('id',row.id).select('*').single();
        if(denied.error)throw denied.error;return json({request:{id:row.id,workspace_id:row.workspace_id,...payload,status:'denied',created_at:row.created_at,decided_at:now}});
      }
      const approved=await db.from('orbitfs_workspace_requests').update({status:'awaiting_target',decided_by_id:user.id,decided_at:now}).eq('id',row.id).select('*').single();
      if(approved.error)throw approved.error;
      if(row.target_user_id)await db.from('orbitfs_notifications').insert({user_id:row.target_user_id,title:'Workspace ownership invitation',body:`${payload.from_username||'Workspace owner'} wants to transfer ownership of ${payload.workspace_name||'a workspace'} to you. Open Workspace Manager to accept or decline.`,level:'info'});
      return json({request:{id:row.id,workspace_id:row.workspace_id,...payload,status:'awaiting_target',created_at:row.created_at,decided_at:now}});
    }
    if(row.status!=='awaiting_target')throw Object.assign(new Error('Request is not awaiting the target user'),{status:409});
    if(row.target_user_id!==user.id)throw Object.assign(new Error('Only the invited user can respond'),{status:403});
    if(body.decision!=='accepted'){
      const declined=await db.from('orbitfs_workspace_requests').update({status:'declined',decided_at:now}).eq('id',row.id).select('*').single();
      if(declined.error)throw declined.error;return json({request:{id:row.id,workspace_id:row.workspace_id,...payload,status:'declined',created_at:row.created_at,decided_at:now}});
    }
    const ws=await db.from('orbitfs_workspaces').select('*').eq('id',row.workspace_id).maybeSingle();
    if(ws.error)throw ws.error;if(!ws.data)throw Object.assign(new Error('Workspace no longer exists'),{status:404});
    const target=await db.from('orbitfs_users').select('id,username,status').eq('id',row.target_user_id).maybeSingle();
    if(target.error)throw target.error;if(!target.data||target.data.status!=='active')throw Object.assign(new Error('Target user is no longer available'),{status:409});
    const previousOwnerId=ws.data.owner_id||ws.data.created_by||payload.from_user_id||row.requested_by_id;
    const changed=await db.from('orbitfs_workspaces').update({owner_id:target.data.id,updated_at:now}).eq('id',ws.data.id);
    if(changed.error)throw changed.error;
    const currentTarget=await db.from('orbitfs_workspace_members').select('mcp_enabled').eq('workspace_id',ws.data.id).eq('user_id',target.data.id).maybeSingle();
    if(currentTarget.error)throw currentTarget.error;
    const newOwner=await db.from('orbitfs_workspace_members').upsert({workspace_id:ws.data.id,user_id:target.data.id,role:'owner',mcp_enabled:currentTarget.data?.mcp_enabled===true},{onConflict:'workspace_id,user_id'});
    if(newOwner.error)throw newOwner.error;
    if(previousOwnerId&&previousOwnerId!==target.data.id){
      const previous=await db.from('orbitfs_workspace_members').upsert({workspace_id:ws.data.id,user_id:previousOwnerId,role:'editor',mcp_enabled:false},{onConflict:'workspace_id,user_id'});
      if(previous.error)throw previous.error;
    }
    const completed=await db.from('orbitfs_workspace_requests').update({status:'completed',decided_at:now}).eq('id',row.id).select('*').single();
    if(completed.error)throw completed.error;
    for(const userId of [previousOwnerId,target.data.id].filter(Boolean))await db.from('orbitfs_notifications').insert({user_id:userId,title:'Workspace ownership transferred',body:`${payload.workspace_name||ws.data.name} is now owned by ${target.data.username}.`,level:'info'});
    return json({transferred:true,workspace:{...ws.data,owner_id:target.data.id},request:{id:row.id,status:'completed'}});
  }catch(e){return fail(e);}
}
