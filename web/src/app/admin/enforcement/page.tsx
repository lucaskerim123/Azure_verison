"use client";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";

export default function Enforcement(){
 const sb=createClient();
 const [rows,setRows]=useState<any[]>([]),[bindings,setBindings]=useState<any[]>([]),[settings,setSettings]=useState<any>({autoSuspend:true,graceDays:0}),[msg,setMsg]=useState(""),[loading,setLoading]=useState(true),[scanning,setScanning]=useState(false);

 async function load(){
  setLoading(true);
  const [q,b,s]=await Promise.all([
   sb.from("license_enforcement_queue").select("*").order("created_at",{ascending:false}).limit(100),
   sb.from("license_bindings").select("id,label,api_source,desired_state,remote_state,suspension_reason,updated_at,license_product_key,archived_at").is("archived_at",null).order("updated_at",{ascending:false}),
   sb.from("app_settings").select("key,value").in("key",["license.auto_suspend_on_overdue_invoice","invoice.suspend_after_days"])
  ]);
  const errors=[q.error?.message,b.error?.message,s.error?.message].filter(Boolean);
  if(errors.length)setMsg(errors.join(" · "));
  setRows(q.data||[]);setBindings(b.data||[]);
  const m=Object.fromEntries((s.data||[]).map((x:any)=>[x.key,x.value]));
  setSettings({autoSuspend:m["license.auto_suspend_on_overdue_invoice"]!==false,graceDays:Number(m["invoice.suspend_after_days"]||0)});
  setLoading(false);
 }
 useEffect(()=>{void load()},[]);

 async function scan(){
  setScanning(true);setMsg("Scanning overdue billing and licence state…");
  const {data,error}=await sb.rpc("run_billing_enforcement_scan");
  setScanning(false);
  if(error){setMsg(`Enforcement scan failed: ${error.message}`);return}
  setMsg(`Scan complete · ${data?.suspended||0} suspended · ${data?.restored||0} restored · ${data?.native_changed||0} website licence changes · ${data?.grace_days??settings.graceDays} day grace.`);
  await load();
 }

 const website=bindings.filter(x=>x.api_source==='website');
 const legacy=bindings.filter(x=>x.api_source!=='website');
 const blocked=bindings.filter(x=>['blocked','suspended','revoked'].includes(x.desired_state));
 const queued=rows.filter(x=>['queued','running'].includes(x.state));

 return <main className="adminShell enforcementV3">
  <header className="adminTop"><div><p className="eyebrow">LICENCE ENFORCEMENT</p><h1>Master licence control</h1><p className="muted">Billing enforcement now follows the real invoice → order → licence relationship. Website licences apply state locally; legacy licences remain queued for the adapter.</p></div><button disabled={scanning||loading} onClick={scan}>{scanning?"Scanning…":"Run billing enforcement scan"}</button></header>

  <section className="stats four enforcementStats">
   <article><small>Website licences</small><strong>{website.length}</strong><span>Native OrbitFS licence control</span></article>
   <article><small>Legacy licences</small><strong>{legacy.length}</strong><span>Adapter-managed licences</span></article>
   <article><small>Blocked / suspended</small><strong>{blocked.length}</strong><span>Current desired state</span></article>
   <article><small>Queued legacy actions</small><strong>{queued.length}</strong><span>Waiting for adapter processing</span></article>
  </section>

  <section className="panel enforcementPolicy"><div className="panelTitle"><div><h2>Billing enforcement policy</h2><p className="muted">These values come from the existing Licence and Invoice settings.</p></div><span className={`customerStatus ${settings.autoSuspend?'active':'suspended'}`}>{settings.autoSuspend?'Automatic':'Disabled'}</span></div><div className="listrow"><div><b>Overdue invoice auto-suspension</b><span>Only licences linked to the overdue order/service are targeted.</span></div><strong>{settings.autoSuspend?'Enabled':'Disabled'}</strong></div><div className="listrow"><div><b>Grace period</b><span>A licence is eligible only after the invoice due date plus this grace period.</span></div><strong>{settings.graceDays} day{settings.graceDays===1?'':'s'}</strong></div></section>

  <section className="panel"><div className="panelTitle"><div><h2>Licence enforcement state</h2><p className="muted">Desired state is OrbitFS control-plane intent. Effective state is the last known applied state.</p></div><span>{bindings.length} licence{bindings.length===1?'':'s'}</span></div>{bindings.length?bindings.map(b=><div className="adminItem" key={b.id}><div><b>{b.label||"OrbitFS licence"}</b><span>{b.license_product_key||"Base"} · {b.api_source||"legacy"} · desired {b.desired_state} · effective {b.remote_state||"unknown"}{b.suspension_reason?` · ${b.suspension_reason}`:""}</span></div><span>{b.api_source==='website'?"Native":"Adapter"}</span></div>):<p className="muted">No active licence bindings.</p>}</section>

  <section className="panel"><div className="panelTitle"><div><h2>Legacy adapter queue</h2><p className="muted">Only legacy/external licence actions appear here. Website licence changes are applied natively.</p></div><span>{rows.length} latest action{rows.length===1?'':'s'}</span></div>{rows.length?rows.map(r=><div className="adminItem" key={r.id}><div><b>{r.action||"Licence action"}</b><span>{r.reason||r.source||"Queued by control plane"}{r.last_error?` · Error: ${r.last_error}`:""}</span></div><span>{r.state||"queued"}</span></div>):<p className="muted">No queued adapter actions.</p>}</section>
  {msg&&<p className="inlineStatus">{msg}</p>}
 </main>
}
