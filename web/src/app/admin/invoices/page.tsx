"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import {usePermissions} from "@/lib/usePermissions";

const due=(i:any)=>Math.max(0,Number(i.total_cents||0)-Number(i.paid_cents||0));
const pretty=(s:any)=>String(s||"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
export default function Invoices(){
 const sb=createClient(),{role}=usePermissions();
 const [rows,setRows]=useState<any[]>([]),[q,setQ]=useState(""),[filter,setFilter]=useState("attention"),[msg,setMsg]=useState("");
 async function load(){const {data}=await sb.from("invoices").select("*").order("created_at",{ascending:false});setRows(data||[])}
 useEffect(()=>{load()},[]);
 const unpaid=rows.filter(x=>!["paid","void","cancelled","refunded"].includes(x.status)&&due(x)>0);
 const overdue=unpaid.filter(x=>x.due_at&&new Date(x.due_at).getTime()<Date.now());
 const partial=rows.filter(x=>x.status==="partial"||Number(x.paid_cents||0)>0&&due(x)>0);
 const paid=rows.filter(x=>x.status==="paid");
 const refunded=rows.filter(x=>x.status==="refunded");
 const outstanding=unpaid.reduce((a,x)=>a+due(x),0);
 const visible=useMemo(()=>rows.filter(i=>{
  const isOverdue=!!i.due_at&&new Date(i.due_at).getTime()<Date.now()&&due(i)>0;
  const matches=filter==="all"||filter==="attention"&&(!["paid","void","cancelled","refunded"].includes(i.status)&&due(i)>0)||filter==="overdue"&&isOverdue||filter===i.status;
  return matches&&`${i.invoice_number} ${i.status} ${i.customer_name||""}`.toLowerCase().includes(q.toLowerCase());
 }),[rows,q,filter]);
 async function remove(i:any){if(!confirm(`Permanently delete invoice ${i.invoice_number}? This cannot be undone.`))return;const reason=prompt("Reason for deleting this invoice?");if(reason===null)return;const {error}=await sb.rpc("superadmin_delete_invoice",{p_invoice_id:i.id,p_reason:reason||null});setMsg(error?.message||`Invoice ${i.invoice_number} deleted.`);if(!error)load()}
 return <main className="adminShell invoiceOpsV3">
  <header className="adminTop"><div><p className="eyebrow">BILLING OPERATIONS</p><h1>Invoices</h1><p className="muted">Receivables first: overdue money, partial payments, refunds and completed invoices.</p></div><div className="inlineActions"><Link className="buttonlink" href="/admin/billing/create?mode=invoice_only">+ Invoice</Link><Link className="buttonlink secondary" href="/admin/billing/create?mode=order_invoice">Order + invoice</Link></div></header>
  <section className="stats four"><article><small>Outstanding</small><strong>${(outstanding/100).toFixed(2)}</strong><span>{unpaid.length} open invoices</span></article><article><small>Overdue</small><strong>{overdue.length}</strong><span>{overdue.length?`$${(overdue.reduce((a,x)=>a+due(x),0)/100).toFixed(2)} late`:"Nothing overdue"}</span></article><article><small>Part paid</small><strong>{partial.length}</strong><span>Payment received, balance remains</span></article><article><small>Paid / refunded</small><strong>{paid.length} / {refunded.length}</strong><span>Completed billing outcomes</span></article></section>
  <section className="panel"><div className="filterBar"><input className="searchInput" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search invoice or customer"/><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="attention">Needs attention</option><option value="overdue">Overdue</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="refunded">Refunded</option><option value="cancelled">Cancelled</option><option value="void">Void</option><option value="all">All invoices</option></select><button className="small secondary" onClick={load}>Refresh</button></div><div className="billingRecordList">{visible.map(i=>{const isOverdue=!!i.due_at&&new Date(i.due_at).getTime()<Date.now()&&due(i)>0;return <div className={`billingRecord ${isOverdue?"isOverdue":""}`} key={i.id}><Link href={`/admin/invoices/${i.id}`} className="billingRecordMain"><b>{i.invoice_number}</b><span>{i.customer_name||"Customer"} · created {new Date(i.created_at).toLocaleDateString()}</span></Link><div><small>Status</small><span className={`billingState ${isOverdue?"overdue":i.status}`}>{isOverdue?"Overdue":pretty(i.status)}</span></div><div><small>Due</small><strong>{i.due_at?new Date(i.due_at).toLocaleDateString():"—"}</strong></div><div><small>Outstanding</small><strong>${(due(i)/100).toFixed(2)}</strong><span>of ${(Number(i.total_cents||0)/100).toFixed(2)}</span></div><div className="inlineActions"><Link className="buttonlink small secondary" href={`/admin/invoices/${i.id}`}>Open</Link>{role==="superadmin"&&<button className="small danger" onClick={()=>remove(i)}>Delete</button>}</div></div>})}{!visible.length&&<div className="v3Empty">No invoices match this view.</div>}</div></section>{msg&&<p className="inlineStatus">{msg}</p>}
 </main>;
}
