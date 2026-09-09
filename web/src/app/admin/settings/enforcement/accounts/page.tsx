"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";

export default function EnforcedCustomers(){
 const sb=createClient();
 const [rows,setRows]=useState<any[]>([]),[msg,setMsg]=useState(""),[loading,setLoading]=useState(true),[filter,setFilter]=useState("all");
 async function load(){setLoading(true);const {data,error}=await sb.rpc("admin_enforced_accounts");setRows(data||[]);setMsg(error?.message||"");setLoading(false)}
 useEffect(()=>{void load()},[]);
 async function reactivate(id:string,name:string){if(!confirm("Reactivate "+name+" and restore licences suspended by account enforcement?"))return;const {error}=await sb.rpc("admin_set_account_enforcement_v2",{target_user:id,new_state:"active",why:null,expires_at:null});setMsg(error?.message||"Account reactivated.");if(!error)load()}
 const shown=rows.filter(x=>filter==="all"||x.effective_state===filter);
 return <main className="adminShell">
  <header className="adminTop"><div><p className="eyebrow">CUSTOMER ENFORCEMENT</p><h1>Suspended & banned users</h1><p className="muted">Current account restrictions, customer-facing reasons and automatic expiry times.</p></div><div className="inlineActions"><button className="secondary" onClick={load}>Refresh</button><Link className="buttonlink secondary" href="/admin/customers">Customers</Link></div></header>
  <section className="stats four"><article><small>Restricted</small><strong>{rows.length}</strong></article><article><small>Suspended</small><strong>{rows.filter(x=>x.effective_state==="suspended").length}</strong></article><article><small>Banned</small><strong>{rows.filter(x=>x.effective_state==="banned").length}</strong></article><article><small>Timed</small><strong>{rows.filter(x=>x.expires_at).length}</strong></article></section>
  <div className="customerControlBar"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All restrictions</option><option value="suspended">Suspended</option><option value="banned">Banned</option></select></div>
  <section className="panel"><div className="panelTitle"><div><h2>Current restrictions</h2><p className="muted">Suspended customers retain Support only. Banned customers cannot access the customer portal.</p></div></div>
   {loading?<p className="muted">Loading enforcement records…</p>:shown.length?shown.map((x:any)=><div className="customerRecord" key={x.id}>
    <Link className="customerRecordMain" href={"/admin/customers/"+x.id}><b>{x.display_name||x.customer_number||x.id}</b><span>{x.customer_number||"Customer"} · {x.reason||"No reason provided"}</span><span className="customerRecordSub">{x.expires_at?("Expires "+new Date(x.expires_at).toLocaleString()):x.effective_state==="banned"?"Permanent ban":"No automatic expiry"}</span></Link>
    <div className="customerRecordMetric"><small>State</small><span className={"customerStatus "+x.effective_state}>{x.effective_state}</span></div>
    <div className="inlineActions"><Link className="buttonlink small secondary" href={"/admin/customers/"+x.id}>Open</Link><button className="small" onClick={()=>reactivate(x.id,x.display_name||x.customer_number||"customer")}>Reactivate</button></div>
   </div>):<div className="v3Empty">No customers currently match this enforcement filter.</div>}
  </section>
  {msg&&<p className="inlineStatus">{msg}</p>}
 </main>
}