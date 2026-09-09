const DEFAULT_STORE_ORIGIN="https://orbitfs.cc";
const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://zekejuprrsurjmwgzexw.supabase.co";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"sb_publishable_eRN8I1CeZ6zHu-mxK0Zc7g_yO47io5c";

function normalizeOrigin(value:string){
  try{return new URL(value).origin.replace(/\/$/,"")}catch{return ""}
}

function localDevelopmentOrigin(requestUrl?:string){
  if(process.env.NODE_ENV==="production"||!requestUrl)return "";
  try{
    const local=new URL(requestUrl);
    if(local.hostname==="localhost"||local.hostname==="127.0.0.1")return local.origin;
  }catch{}
  return "";
}

async function configuredStoreOrigin(){
  try{
    const endpoint=new URL(`${SUPABASE_URL}/rest/v1/app_settings`);
    endpoint.searchParams.set("key","eq.site.public_url");
    endpoint.searchParams.set("select","value");
    endpoint.searchParams.set("limit","1");
    const response=await fetch(endpoint,{headers:{apikey:SUPABASE_KEY},cache:"no-store"});
    if(response.ok){
      const rows=await response.json().catch(()=>[]);
      const configured=normalizeOrigin(String(rows?.[0]?.value||""));
      if(configured)return configured;
    }
  }catch{}
  const env=normalizeOrigin(process.env.NEXT_PUBLIC_ORBITFS_STORE_URL||process.env.NEXT_PUBLIC_SITE_URL||process.env.SITE_URL||"");
  return env||DEFAULT_STORE_ORIGIN;
}

export async function orbitfsStoreOrigin(requestUrl?:string){
  return localDevelopmentOrigin(requestUrl)||await configuredStoreOrigin();
}

export async function orbitfsStoreUrl(path="",requestUrl?:string){
  const origin=await orbitfsStoreOrigin(requestUrl);
  if(!path)return origin;
  return `${origin}${path.startsWith("/")?path:`/${path}`}`;
}

export const ORBITFS_STORE_ORIGIN=DEFAULT_STORE_ORIGIN;
