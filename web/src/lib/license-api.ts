import {createClient as createSupabaseClient} from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://zekejuprrsurjmwgzexw.supabase.co";
const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"sb_publishable_eRN8I1CeZ6zHu-mxK0Zc7g_yO47io5c";

export const licenseDb=()=>createSupabaseClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
export const cors={"access-control-allow-origin":"*","access-control-allow-headers":"content-type,authorization","access-control-allow-methods":"GET,POST,OPTIONS","cache-control":"no-store"};
export const reply=(body:any,status=200)=>Response.json(body,{status,headers:cors});
export const bodyOf=async(req:Request)=>req.json().catch(()=>({}));

const encoder=new TextEncoder();
const base64url=(data:Uint8Array)=>Buffer.from(data).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const pemBytes=(pem:string)=>Uint8Array.from(Buffer.from(pem.replace(/-----[^-]+-----/g,"").replace(/\s+/g,""),"base64"));

function privateSigningPem(){
  const encoded=String(process.env.LICENSE_ENTITLEMENT_PRIVATE_KEY_B64||"").trim();
  if(encoded)return Buffer.from(encoded,"base64").toString("utf8");
  return String(process.env.LICENSE_ENTITLEMENT_PRIVATE_KEY||"").trim();
}

export function publicSigningPem(){
  const encoded=String(process.env.LICENSE_ENTITLEMENT_PUBLIC_KEY_B64||"").trim();
  if(encoded)return Buffer.from(encoded,"base64").toString("utf8");
  return String(process.env.LICENSE_ENTITLEMENT_PUBLIC_KEY||"").trim();
}

export function signingConfigured(){return !!privateSigningPem()}

export async function runtimeLicenseSettings(){
  const {data,error}=await licenseDb().rpc("website_license_runtime_settings");
  if(error)throw error;
  return data||{};
}

export async function signEntitlement(payload:Record<string,unknown>){
  const pem=privateSigningPem();
  if(!pem)throw new Error("Website licence entitlement signing key is not configured");
  const key=await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(pem),
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},
    false,
    ["sign"]
  );
  const header=base64url(encoder.encode(JSON.stringify({alg:"RS256",typ:"JWT"})));
  const body=base64url(encoder.encode(JSON.stringify(payload)));
  const input=`${header}.${body}`;
  const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,encoder.encode(input));
  return `${input}.${base64url(new Uint8Array(sig))}`;
}
