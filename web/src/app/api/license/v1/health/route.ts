import {cors,publicSigningPem,reply,runtimeLicenseSettings,signingConfigured} from "@/lib/license-api";

export async function GET(){
  try{
    const s:any=await runtimeLicenseSettings();
    const ready=!!s?.enabled&&s?.mode!=='standby'&&signingConfigured()&&!!publicSigningPem();
    return reply({
      ok:ready,
      service:s?.api_name||"OrbitFS Licence API",
      version:"v1",
      mode:s?.mode||"standby",
      enabled:!!s?.enabled,
      signingConfigured:signingConfigured(),
      publicKeyConfigured:!!publicSigningPem(),
      issuer:s?.issuer||"orbitfs-website",
      audience:s?.audience||"orbitfs-runtime",
      entitlementTtlSeconds:Number(s?.entitlement_ttl_seconds||10800),
      graceSeconds:s?.allow_offline_grace===false?0:Number(s?.grace_seconds||604800),
      time:new Date().toISOString()
    },ready?200:503);
  }catch(e:any){
    return reply({ok:false,error:e.message||"Licence API health check failed"},500);
  }
}

export async function OPTIONS(){return new Response(null,{status:204,headers:cors})}
