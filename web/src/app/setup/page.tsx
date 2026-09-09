"use client";
import {FormEvent,useEffect,useState} from "react";
import Link from "next/link";

export default function FirstSetup(){
 const [available,setAvailable]=useState<boolean|null>(null);
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 useEffect(()=>{fetch("/api/setup/first-user").then(r=>r.json()).then(d=>setAvailable(!!d.available)).catch(()=>setMessage("Could not check Store setup status."))},[]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;setBusy(true);setMessage("");
  const f=new FormData(e.currentTarget);
  const payload={username:String(f.get("username")||""),email:String(f.get("email")||""),password:String(f.get("password")||"")};
  const r=await fetch("/api/setup/first-user",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  const d=await r.json().catch(()=>({}));setMessage(r.ok?(d.message||"Owner created."):(d.error||"Setup failed."));setBusy(false);if(r.ok)setAvailable(false);
 }
 return <main className="orbitAuthPage orbitAuthAdmin">
  <header className="orbitAuthTop"><Link className="orbitAuthBrand" href="/"><span className="orbitAuthMark"/><span>OrbitFS Master Store</span></Link><nav className="orbitAuthNav"><Link href="/">Storefront</Link><Link href="/admin/login">Admin sign in</Link></nav></header>
  <div className="orbitAuthStage">
   <section className="orbitAuthStory"><p className="orbitAuthEyebrow">First install</p><h2>Set up the Store<br/><span>owner account.</span></h2><p>This one-time setup creates the first Master Admin owner, the Superadmin staff group and the initial customer identity.</p><p className="orbitAuthStoryFoot">After the first owner exists, this setup endpoint locks automatically.</p></section>
   <section className="orbitAuthCard"><p className="orbitAuthEyebrow">Initial system setup</p><h1>Create Store owner</h1><p className="orbitAuthDescription">Use the account you will use to operate products, orders, licences, customers and the Store administration system.</p>
    {available===null?<p className="orbitAuthMessage">Checking setup status…</p>:available?<form onSubmit={submit} className="orbitAuthForm">
      <label className="orbitAuthFieldLabel">Username<span className="orbitAuthField"><span className="orbitAuthFieldIcon">◎</span><input name="username" minLength={3} maxLength={32} required placeholder="Owner username"/></span></label>
      <label className="orbitAuthFieldLabel">Email address<span className="orbitAuthField"><span className="orbitAuthFieldIcon">@</span><input name="email" type="email" required placeholder="owner@example.com"/></span></label>
      <label className="orbitAuthFieldLabel">Password<span className="orbitAuthField"><span className="orbitAuthFieldIcon">●</span><input name="password" type="password" minLength={10} required placeholder="Minimum 10 characters"/></span></label>
      <button className="orbitAuthSubmit" disabled={busy}>{busy?"Creating owner…":"Create Store owner →"}</button>
    </form>:<p className="orbitAuthMessage">First-user setup is locked. Staff access already exists. <Link href="/admin/login">Go to Master Admin sign in.</Link></p>}
    {message&&<p className="orbitAuthMessage" role="status">{message}</p>}
   </section>
  </div>
 </main>
}
