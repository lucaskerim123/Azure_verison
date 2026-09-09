"use client";
import {useState} from "react";
import {usePathname} from "next/navigation";
import {createClient} from "@/lib/supabase";

export default function AdminCustomerResetAction(){
 const path=usePathname(),sb=createClient(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const match=path.match(/^\/admin\/customers\/([0-9a-f-]{36})$/i);if(!match)return null;
 async function send(){
  if(busy)return;setBusy(true);setMessage("Sending reset…");
  const {data:{session}}=await sb.auth.getSession();if(!session?.access_token){setBusy(false);setMessage("Session expired.");return}
  const r=await fetch("/api/admin/customers/password-reset",{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({userId:match![1]})});
  const j=await r.json().catch(()=>({}));setBusy(false);setMessage(r.ok?j.message:(j.error||"Reset email failed."));
 }
 return <div className="adminCustomerResetAction"><button type="button" onClick={send} disabled={busy}>{busy?"Sending…":"Send password reset"}</button>{message&&<span>{message}</span>}</div>;
}
