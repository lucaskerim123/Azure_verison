import {bodyOf,cors,licenseDb,reply,runtimeLicenseSettings,signEntitlement,signingConfigured} from "@/lib/license-api";

export async function POST(req:Request){
  const b=await bodyOf(req);
  const licenseKey=b.licenseKey||b.license_key;
  const installationId=b.installationId||b.installation_id;
  const requested=Array.isArray(b.components)?b.components.map((x:any)=>String(x)):null;

  let settings:any;
  try{settings=await runtimeLicenseSettings()}catch(e:any){return reply({error:e.message||"Licence API settings unavailable",code:"LICENSE_API_SETTINGS_ERROR"},500)}
  if(!settings?.enabled)return reply({error:"Website licence API is disabled",code:"LICENSE_API_DISABLED"},503);
  if(settings?.mode==='standby')return reply({error:"Website licence API is in standby mode",code:"LICENSE_API_STANDBY"},503);
  if(!signingConfigured())return reply({error:"Website licence entitlement signing is not configured",code:"ENTITLEMENT_SIGNING_NOT_CONFIGURED"},503);

  const {data,error}=await licenseDb().rpc("website_license_validate",{
    p_license_key:licenseKey,
    p_installation_id:installationId,
    p_components:requested,
    p_activate:!!b.activate,
    p_device_name:b.deviceName||null,
    p_platform:b.platform||null,
    p_app_version:b.appVersion||null
  });
  if(error)return reply({error:error.message,code:"LICENSE_VALIDATION_ERROR"},400);
  if(data?.reason==='license_not_found')return reply({error:"Licence not found",code:"LICENSE_NOT_FOUND"},404);

  const now=Math.floor(Date.now()/1000);
  const ttl=Math.max(60,Number(settings.entitlement_ttl_seconds||10800));
  const grace=settings.allow_offline_grace===false?0:Math.max(0,Number(settings.grace_seconds||604800));
  const payload={
    iss:settings.issuer||"orbitfs-website",
    aud:settings.audience||"orbitfs-runtime",
    iat:now,
    exp:now+ttl,
    graceUntil:now+ttl+grace,
    valid:!!data?.valid,
    reason:data?.reason??null,
    licenceId:data?.licenceId||data?.bindingId||null,
    installationId:String(installationId||""),
    components:data?.components||{}
  };

  try{
    const entitlement=await signEntitlement(payload);
    return reply({entitlement});
  }catch(e:any){
    return reply({error:e.message||"Entitlement signing failed",code:"ENTITLEMENT_SIGNING_ERROR"},500);
  }
}

export async function OPTIONS(){return new Response(null,{status:204,headers:cors})}
