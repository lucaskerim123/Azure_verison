import {licenseDb,reply,cors} from "@/lib/license-api";
export async function GET(){const {data,error}=await licenseDb().rpc("website_license_revision");return error?reply({error:error.message},500):reply(data)}
export async function OPTIONS(){return new Response(null,{status:204,headers:cors})}
