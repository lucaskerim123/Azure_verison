import {bodyOf,cors,licenseDb,reply} from "@/lib/license-api";
import {compatibleComponentList} from "@/lib/license-components";
export async function POST(req:Request){const b=await bodyOf(req);const {data,error}=await licenseDb().rpc("website_license_register",{p_license_key:b.licenseKey||b.license_key,p_installation_id:b.installationId||b.installation_id,p_components:compatibleComponentList(b.components),p_device_name:b.deviceName||null,p_platform:b.platform||null,p_app_version:b.appVersion||null});return error?reply({error:error.message,code:"LICENSE_ACTIVATION_ERROR"},400):reply(data)}
export async function OPTIONS(){return new Response(null,{status:204,headers:cors})}
