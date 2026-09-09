import {licenseDb} from "@/lib/license-api";
import {event} from "@/lib/orbitfs-deployment";
import {serviceRpc} from "@/lib/paymentServer";

const VERCEL_API="https://api.vercel.com";

function nextState(install:any){
  if(install.database_initialized_at&&install.supabase_project_ref)return "awaiting_vercel";
  if(install.supabase_project_ref)return "preparing_database";
  return "awaiting_supabase";
}

async function installationVercelApi(install:any,path:string,init:RequestInit={}){
  const token=String(await serviceRpc("service_orbitfs_provider_secret",{p_user_id:install.auth_user_id,p_provider:"vercel",p_key:"access_token"})||"").trim();
  if(!token)throw Object.assign(new Error("Vercel API access is not connected"),{status:409});
  const url=new URL(path,VERCEL_API);if(install.vercel_team_id)url.searchParams.set("teamId",String(install.vercel_team_id));
  const r=await fetch(url,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(init.headers||{})},cache:"no-store"});
  if(!r.ok)throw Object.assign(new Error(`Vercel API ${r.status}: ${await r.text()}`),{status:r.status>=500?502:r.status});
  return r.status===204?null:r.json();
}

export async function clearPanelRegistration(install:any,reason="Panel project is not deployed"){
  const patch={state:nextState(install),vercel_project_id:null,vercel_project_name:null,vercel_deployment_id:null,deployment_url:null,production_url:null,release_version:null,release_id:null,release_sha256:null,release_source_commit:null,previous_release_version:null,latest_available_release:null,health_status:"unknown",last_health_at:null,last_error:null};
  const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();
  if(error)throw error;
  await event(data,"panel.registration_cleared","warning",reason,{previousProjectId:install.vercel_project_id||null,teamId:install.vercel_team_id||null});
  return data;
}

export async function reconcileOrbitfsInstallation(install:any){
  if(!install?.vercel_project_id)return install;
  try{await installationVercelApi(install,`/v9/projects/${encodeURIComponent(install.vercel_project_id)}`);return install}
  catch(e:any){if(Number(e?.status)!==404)throw e;return clearPanelRegistration(install,"The customer Vercel project no longer exists. OrbitFS kept the Supabase database and cleared the stale Panel registration.")}
}

export async function undeployOrbitfsPanel(install:any){
  let current=install;
  if(current.vercel_project_id){
    try{await installationVercelApi(current,`/v9/projects/${encodeURIComponent(current.vercel_project_id)}`,{method:"DELETE"});await event(current,"panel.undeployed","ok",`Removed OrbitFS Panel project ${current.vercel_project_name||current.vercel_project_id} from the customer Vercel account`)}
    catch(e:any){if(Number(e?.status)!==404)throw e;await event(current,"panel.undeployed","warning","The customer Vercel project had already been removed outside OrbitFS")}
  }
  current=await clearPanelRegistration(current,"OrbitFS Panel undeployed. Customer Supabase project and database were preserved.");
  return current;
}

export async function deregisterOrbitfsInstallation(install:any,removePanel=true){
  let current=await reconcileOrbitfsInstallation(install);
  if(current.vercel_project_id){if(!removePanel)throw Object.assign(new Error("Undeploy the customer Vercel Panel before deregistering this installation"),{status:409});current=await undeployOrbitfsPanel(current)}
  const removed=await serviceRpc("service_delete_orbitfs_installation",{p_installation_id:current.id});
  if(removed!==true)throw Object.assign(new Error("OrbitFS installation was not found"),{status:404});
  return {ok:true,id:current.id,installationId:current.installation_id,supabaseProjectRef:current.supabase_project_ref||null};
}
