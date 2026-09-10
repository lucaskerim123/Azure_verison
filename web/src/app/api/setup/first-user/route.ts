import {createClient} from "@supabase/supabase-js";
import {hashCustomerPassword} from "@/lib/customer-auth-server";

const url=(process.env.ORBITFS_SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||"https://adutmcvusqeqonpvfcps.supabase.co").trim();
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";

export async function GET(){
  if(!serviceKey)return Response.json({ok:false,available:false,error:"Store database is not configured."},{status:503});
  const db=createClient(url,serviceKey,{auth:{persistSession:false}});
  const {count,error}=await db.from("staff_members").select("user_id",{count:"exact",head:true});
  if(error)return Response.json({ok:false,available:false,error:error.message},{status:500});
  return Response.json({ok:true,available:(count||0)===0,staff_count:count||0});
}

export async function POST(req:Request){
  if(!serviceKey)return Response.json({error:"Store database is not configured."},{status:503});
  const body=await req.json().catch(()=>({}));
  const email=String(body.email||"").trim().toLowerCase();
  const password=String(body.password||"");
  const username=String(body.username||"").trim();
  if(!email.includes("@")||password.length<10||!username)return Response.json({error:"Enter a valid email, username and a password of at least 10 characters."},{status:400});

  const db=createClient(url,serviceKey,{auth:{persistSession:false}});
  const {count}=await db.from("staff_members").select("user_id",{count:"exact",head:true});
  if((count||0)>0)return Response.json({error:"First-user setup is already locked because staff access exists."},{status:409});

  const {data:created,error:createError}=await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{username,display_name:username}});
  if(createError||!created.user)return Response.json({error:createError?.message||"Could not create the owner account."},{status:400});
  const userId=created.user.id;
  try{
    const {data:group,error:groupError}=await db.from("staff_groups").upsert({slug:"superadmin",name:"Superadmin",description:"Initial Store owner with unrestricted control-plane access.",permissions:{all:true},is_system:true,sort_order:1,updated_at:new Date().toISOString()},{onConflict:"slug"}).select("id").single();
    if(groupError||!group)throw groupError||new Error("Could not create the Superadmin group.");
    const {error:profileError}=await db.from("user_profiles").upsert({id:userId,role:"superadmin",status:"active",display_name:username,email_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"id"});
    if(profileError)throw profileError;
    const {error:staffError}=await db.from("staff_members").insert({user_id:userId,status:"active",title:"System Owner",department:"Administration",staff_notes:"Created by first-user setup.",created_by:userId,updated_at:new Date().toISOString()});
    if(staffError)throw staffError;
    const {error:membershipError}=await db.from("staff_member_groups").insert({user_id:userId,group_id:group.id,is_primary:true});
    if(membershipError)throw membershipError;
    const verifiedAt=new Date().toISOString();
    const {error:customerError}=await db.from("customers").insert({auth_user_id:userId,email,name:username,username,display_name:username,status:"active",email_verified_at:verifiedAt,metadata:{registration_source:"first_user_setup"},updated_at:verifiedAt});
    if(customerError)throw customerError;
    const {error:credentialError}=await db.from("customer_credentials").insert({user_id:userId,password_hash:hashCustomerPassword(password),password_changed_at:verifiedAt,created_at:verifiedAt,updated_at:verifiedAt});
    if(credentialError)throw credentialError;
    return Response.json({ok:true,message:"First Store owner created, verified and granted full admin access. You can now sign in to the Master Admin."});
  }catch(error:any){
    try{await db.auth.admin.deleteUser(userId)}catch{}
    return Response.json({error:error?.message||"First-user setup failed."},{status:500});
  }
}
