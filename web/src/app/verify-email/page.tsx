"use client";
import {useEffect,useState} from "react";
import Link from "next/link";

export default function VerifyEmail(){
 const [state,setState]=useState<"loading"|"ok"|"error">("loading"),[message,setMessage]=useState("Verifying your OrbitFS email…");
 useEffect(()=>{
  const token=new URLSearchParams(window.location.search).get("token")||"";
  if(!token){setState("error");setMessage("This verification link is missing its token.");return}
  fetch("/api/auth/email-verification/complete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token})})
   .then(async r=>({ok:r.ok,data:await r.json().catch(()=>({}))}))
   .then(({ok,data})=>{setState(ok?"ok":"error");setMessage(ok?"Your email is verified. You can now sign in to OrbitFS.":data.error||"This verification link is invalid or has expired.")})
   .catch(()=>{setState("error");setMessage("OrbitFS could not verify this email right now.")})
 },[]);
 return <main className="orbitAuthPage orbitAuthCustomer"><div className="orbitAuthStage"><section className="orbitAuthCard"><p className="orbitAuthEyebrow">EMAIL VERIFICATION</p><h1>{state==="ok"?"Email verified":state==="error"?"Verification failed":"Verifying email"}</h1><p className="orbitAuthDescription">{message}</p><p className="orbitAuthSwitch"><Link href="/login">Back to sign in</Link></p><p className="orbitAuthSupport"><Link href="/support">Contact support</Link></p></section></div></main>
}