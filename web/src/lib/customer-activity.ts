import {createClient} from "@/lib/supabase";

type ActivityOptions={source?:string;route?:string;entityType?:string;entityId?:string;success?:boolean;detail?:Record<string,unknown>};

function getRef(storage:Storage,key:string){let v=storage.getItem(key);if(!v){v=crypto.randomUUID();storage.setItem(key,v)}return v}

export async function trackCustomerActivity(eventType:string,options:ActivityOptions={}){
  if(typeof window==="undefined")return;
  try{
    const sb=createClient();const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)return;
    const sessionRef=getRef(sessionStorage,"orbitfs_session_ref"),deviceRef=getRef(localStorage,"orbitfs_device_ref");
    const detail={...(options.detail||{}),device_ref:deviceRef,client:{timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,language:navigator.language,platform:navigator.platform,screen:`${screen.width}x${screen.height}`,viewport:`${innerWidth}x${innerHeight}`}};
    await fetch("/api/account/activity",{method:"POST",headers:{authorization:`Bearer ${session.access_token}`,"content-type":"application/json"},body:JSON.stringify({eventType,source:options.source||"portal",route:options.route||location.pathname+location.search,entityType:options.entityType||null,entityId:options.entityId||null,success:options.success!==false,sessionRef,detail}),keepalive:true});
  }catch{}
}
