"use client";
import {useState} from "react";
import {usePathname,useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase";

export function SuperadminCustomerPasswordControl({userId,role}:{userId:string;role:string|null}){
  const sb=createClient();
  const [password,setPassword]=useState(""),[confirmPassword,setConfirmPassword]=useState(""),[passwordBusy,setPasswordBusy]=useState(false),[passwordMessage,setPasswordMessage]=useState("");
  if(role!=="superadmin")return null;
  async function setCustomerPassword(){
    if(passwordBusy)return;
    if(password.length<8){setPasswordMessage("Password must be at least 8 characters.");return}
    if(password!==confirmPassword){setPasswordMessage("Passwords do not match.");return}
    if(!confirm("Set this customer's password now? This takes effect immediately."))return;
    setPasswordBusy(true);setPasswordMessage("Updating password…");
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token){setPasswordBusy(false);setPasswordMessage("Session expired.");return}
    let targetId=userId;
    try{
      const {data:customer}=await sb.from("customers").select("id").eq("auth_user_id",userId).maybeSingle();
      if(customer?.id)targetId=String(customer.id);
    }catch{}
    const response=await fetch("/api/admin/customers/password",{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({userId:targetId,password})});
    const result=await response.json().catch(()=>({}));
    setPasswordBusy(false);setPasswordMessage(response.ok?(result.message||"Customer password updated."):(result.error||"Could not update customer password."));
    if(response.ok){setPassword("");setConfirmPassword("")}
  }
  return <div className="form" style={{marginTop:12}}><div className="two"><input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="New password"/><input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Confirm password"/></div><button type="button" onClick={setCustomerPassword} disabled={passwordBusy}>{passwordBusy?"Updating…":"Set password"}</button>{passwordMessage&&<span className="muted">{passwordMessage}</span>}</div>;
}

export default function SuperadminDeleteBar({role}:{role:string|null}){
  const path=usePathname(),router=useRouter(),sb=createClient();
  if(role!=="superadmin")return null;
  if(/^\/admin\/orders\/[^/]+$/.test(path)||path==="/admin/customers/cancellations")return null;
  const m=path.match(/^\/admin\/(orders|invoices|customers)\/([^/]+)$/);
  if(!m)return null;
  const kind=m[1] as "orders"|"invoices"|"customers",id=m[2];
  const label=kind==="orders"?"order":kind==="invoices"?"invoice":"customer";
  const rpc=kind==="orders"?"superadmin_delete_order":kind==="invoices"?"superadmin_delete_invoice":"superadmin_delete_customer";
  const idKey=kind==="orders"?"p_order_id":kind==="invoices"?"p_invoice_id":"p_user_id";
  const back=kind==="orders"?"/admin/orders":kind==="invoices"?"/admin/invoices":"/admin/customers";
  async function remove(){
    if(!confirm(`Permanently delete this ${label}? This cannot be undone.`))return;
    const reason=prompt(`Reason for deleting this ${label}?`);if(reason===null)return;
    const {error}=await sb.rpc(rpc,{[idKey]:id,p_reason:reason||null});
    if(error){alert(error.message);return}
    router.replace(back);router.refresh();
  }
  return <div className="superadminDeleteBar"><div><b>Superadmin controls</b><span>Permanent deletion is restricted to superadmin and audit logged.</span></div><button className="danger" onClick={remove}>Delete {label}</button></div>;
}
