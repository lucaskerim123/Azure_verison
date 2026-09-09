"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import {usePermissions} from "@/lib/usePermissions";
const pretty=(v:any)=>String(v||"—").replaceAll("_"," ").replace(/\b\w/g,x=>x.toUpperCase());
const money=(n:any,c="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency:c}).format(Number(n||0)/100);
export default function CancellationRequests(){
 const sb=createClient(),{can}=usePermissions();
 const [data,setData]=useState<any>({requests:[],pending_count:0,scheduled_count:0}),[tab,setTab]=useState("pending"),[busy,setBusy]=useState<string>(),[msg,setMsg]=useState("");
 async function load(){const {data:d,error}=await sb.rpc("admin_cancellation_queue_snapshot");if(error)return setMsg(error.message);setData(d||{requests:[]})}
 useEffect(()=>{if(can("customers.cancellations"))load()},[can]);
 const rows=useMemo(()=>{const all=data.requests||[];if(tab==="pending")return all.filter((x:any)=>x.status==="requested");if(tab==="scheduled")return all.filter((x:any)=>x.status==="approved_scheduled");return all.filter((x:any)=>!["requested","approved_scheduled"].includes(x.status))},[data,tab]);
 async function callReview(body:any){const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw new Error("Authentication expired.");const r=await fetch("/api/admin/cancellations/review",{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Cancellation action failed.");return d}
 async function review(r:any,decision:"approve"|"deny"){
  const refundText=Number(r.refund_amount_cents||0)>0?` This will also automatically refund ${money(r.refund_amount_cents,r.currency||"AUD")} to ${r.refund_preference==="wallet"?"the customer’s OrbitFS Wallet":"the original payment method(s)"}.`:"";
  if(decision==="approve"&&r.requested_timing==="immediate"&&!confirm(`Approve cancellation for order #${r.order_number}? This will terminate the service immediately.${refundText}`))return;
  const note=prompt(decision==="deny"?"Reason / note for denying this request":"Approval note (optional)")||"";
  if(decision==="deny"&&!note.trim())return setMsg("A denial note is required.");
  setBusy(r.id);setMsg(decision==="approve"?"Approving cancellation…":"Denying cancellation…");
  try{
   const d=await callReview({request_id:r.id,decision,staff_note:note||null});
   const refund=d?.refund;
   if(refund?.status==="completed")setMsg(`Cancellation approved. Refund completed: ${money(refund.processed_cents||r.refund_amount_cents,r.currency||"AUD")}.`);
   else if(refund?.status==="processing")setMsg(`Cancellation approved. Refund submitted and processing; the payment provider may take time to return the funds.`);
   else if(["failed","partial_failed"].includes(refund?.status))setMsg(`Cancellation approved, but the automatic refund needs attention: ${refund.error||refund.refund_last_error||"refund processing failed"}`);
   else setMsg((d?.review?.status==="approved_scheduled")?`Cancellation scheduled for ${new Date(d.review.scheduled_for).toLocaleString()}.`:`Cancellation ${decision==="approve"?"approved":"denied"}.`);
   await load();
  }catch(e:any){setMsg(e?.message||"Cancellation action failed.")}finally{setBusy(undefined)}
 }
 async function retryRefund(r:any){
  if(!confirm(`Retry the automatic ${money(Math.max(0,Number(r.refund_amount_cents||0)-Number(r.refund_processed_cents||0)),r.currency||"AUD")} refund for order #${r.order_number}?`))return;
  setBusy(r.id);setMsg("Retrying refund…");
  try{const d=await callReview({request_id:r.id,action:"refund.retry"});const x=d?.refund;setMsg(x?.status==="completed"?"Refund completed.":x?.status==="processing"?"Refund submitted and is processing.":`Refund status: ${pretty(x?.status)}${x?.error?` · ${x.error}`:""}`);await load()}catch(e:any){setMsg(e?.message||"Refund retry failed.")}finally{setBusy(undefined)}
 }
 if(!can("customers.cancellations"))return <main className="adminShell"><section className="panel"><h1>Permission required</h1></section></main>;
 return <main className="adminShell cancellationPage"><header className="adminTop"><div><p className="eyebrow">CUSTOMERS / SERVICE CONTROL</p><h1>Cancellation requests</h1><p className="muted">Review customer cancellation requests, including automatic refunds for partially paid orders that were never activated.</p></div><button className="secondary" onClick={load}>Refresh</button></header>
 <section className="stats four"><article><small>Needs review</small><strong>{data.pending_count||0}</strong></article><article><small>Scheduled</small><strong>{data.scheduled_count||0}</strong></article><article><small>Total loaded</small><strong>{(data.requests||[]).length}</strong></article><article><small>Processor</small><strong>15 min</strong><span>Automatic cycle-end termination</span></article></section>
 <nav className="recordTabs"><button className={tab==="pending"?"active":""} onClick={()=>setTab("pending")}>Pending ({data.pending_count||0})</button><button className={tab==="scheduled"?"active":""} onClick={()=>setTab("scheduled")}>Scheduled ({data.scheduled_count||0})</button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}>History</button></nav>
 <section className="panel"><div className="panelTitle"><div><h2>{tab==="pending"?"Requests awaiting review":tab==="scheduled"?"Approved end-of-cycle cancellations":"Completed / denied requests"}</h2><p className="muted">Immediate approvals terminate the order. When a never-activated order has a partial payment, its saved refund preference is processed automatically after approval.</p></div></div>
 {rows.length?rows.map((r:any)=>{const refundDue=Math.max(0,Number(r.refund_amount_cents||0)-Number(r.refund_processed_cents||0));return <article className="cancellationRequestRow" key={r.id}><div className="cancellationRequestMain"><div className="panelTitle"><div><b>{r.customer_name}</b><span>{r.customer_email||"No email"}</span></div><span className={`mailTemplateState ${r.status==="requested"?"off":"on"}`}>{pretty(r.status)}</span></div><h3>Order #{r.order_number}</h3><p>{r.reason}</p><div className="cancellationMeta"><span><b>Requested:</b> {pretty(r.requested_timing)}</span><span><b>Created:</b> {new Date(r.created_at).toLocaleString()}</span>{r.scheduled_for&&<span><b>Ends:</b> {new Date(r.scheduled_for).toLocaleString()}</span>}{r.interval_unit&&<span><b>Billing:</b> every {r.interval_count||1} {r.interval_unit}</span>}{r.invoice_number&&<span><b>Invoice:</b> {r.invoice_number} · {pretty(r.invoice_status)}</span>}</div>{Number(r.refund_amount_cents||0)>0&&<div className="notice" style={{marginTop:10}}><b>Automatic refund · {money(r.refund_amount_cents,r.currency||"AUD")}</b><span>Destination: {r.refund_preference==="wallet"?"OrbitFS Wallet":"original payment method(s)"} · Status: {pretty(r.refund_status)}{refundDue>0?` · ${money(refundDue,r.currency||"AUD")} remaining`:""}</span>{r.refund_preference==="original"&&<small>Stripe/PayPal refunds are sent through the original provider and may not appear instantly.</small>}{r.refund_last_error&&<small>Last error: {r.refund_last_error}</small>}</div>}{r.staff_note&&<small>Staff note: {r.staff_note}</small>}</div>
 <div className="cancellationRequestActions"><Link href={`/admin/customers/${r.auth_user_id}`}>Customer →</Link><Link href={`/admin/orders/${r.order_id}`}>Order →</Link>{r.invoice_id&&<Link href={`/admin/invoices/${r.invoice_id}`}>Invoice →</Link>}{r.status==="requested"&&<><button disabled={busy===r.id} onClick={()=>review(r,"approve")}>{r.requested_timing==="end_of_cycle"?"Approve & schedule":Number(r.refund_amount_cents||0)>0?"Approve, terminate & refund":"Approve & terminate"}</button><button className="danger" disabled={busy===r.id} onClick={()=>review(r,"deny")}>Deny</button></>}{r.status==="completed"&&Number(r.refund_amount_cents||0)>0&&["pending","failed","partial_failed"].includes(r.refund_status)&&<button disabled={busy===r.id} onClick={()=>retryRefund(r)}>Retry refund</button>}</div></article>}):<div className="emptyState"><b>No requests in this view</b><span>Nothing currently needs attention here.</span></div>}
 </section><p className="inlineStatus">{msg}</p></main>;
}
