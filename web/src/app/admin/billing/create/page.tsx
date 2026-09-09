"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type Line={product_id:string;description:string;quantity:number;unit_price:string};
const blank=():Line=>({product_id:"",description:"",quantity:1,unit_price:"0.00"});

export default function CreateBilling(){
 const sb=createClient();
 const [customers,setCustomers]=useState<any[]>([]),[products,setProducts]=useState<any[]>([]);
 const [mode,setMode]=useState("order_invoice"),[customer,setCustomer]=useState(""),[currency,setCurrency]=useState("AUD"),[due,setDue]=useState(""),[notes,setNotes]=useState("");
 const [lines,setLines]=useState<Line[]>([blank()]),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false),[created,setCreated]=useState<any>();
 useEffect(()=>{const p=new URLSearchParams(location.search).get("mode");if(p&&["order_invoice","order_only","invoice_only"].includes(p))setMode(p);Promise.all([sb.from("customers").select("id,customer_number,name,email,auth_user_id").not("auth_user_id","is",null).order("name"),sb.from("products").select("id,name,price_cents,currency,active").eq("active",true).order("name")]).then(([c,p])=>{setCustomers(c.data||[]);setProducts(p.data||[])})},[]);
 const total=useMemo(()=>lines.reduce((n,l)=>n+Math.max(1,Number(l.quantity)||1)*Math.round((Number(l.unit_price)||0)*100),0),[lines]);
 function patch(i:number,v:Partial<Line>){setLines(x=>x.map((l,n)=>n===i?{...l,...v}:l))}
 function pick(i:number,id:string){const p=products.find(x=>x.id===id);patch(i,{product_id:id,description:p?.name||"",unit_price:p?.price_cents!=null?(p.price_cents/100).toFixed(2):"0.00"});if(p?.currency)setCurrency(p.currency)}
 async function notify(eventKey:string,to:string,vars:any,relatedType:string,relatedId:any){const {data}=await sb.auth.getSession();const t=data.session?.access_token;if(!t)throw new Error(`Could not send ${eventKey}: authentication expired.`);const r=await fetch('/api/mail/transactional',{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({eventKey,to,vars,relatedType,relatedId})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`${eventKey} email failed.`);return d}
 async function create(){if(!customer)return setMsg("Choose a customer.");if(lines.some(l=>!l.description.trim()))return setMsg("Every line needs a description.");setBusy(true);setCreated(undefined);setMsg("Creating…");const payload=lines.map(l=>({product_id:l.product_id||null,description:l.description.trim(),quantity:Math.max(1,Number(l.quantity)||1),unit_price_cents:Math.max(0,Math.round((Number(l.unit_price)||0)*100))}));const {data,error}=await sb.rpc("admin_create_order_invoice",{p_customer_id:customer,p_mode:mode,p_currency:currency,p_due_at:due?new Date(`${due}T12:00:00`).toISOString():null,p_notes:notes||null,p_lines:payload});if(error){setBusy(false);return setMsg(error.message)}setCreated(data);const c=customers.find(x=>x.id===customer);const formatted=new Intl.NumberFormat('en-AU',{style:'currency',currency}).format(total/100);const jobs:Promise<any>[]=[];if(c?.email&&data?.order_id)jobs.push(notify('order.created',c.email,{order_number:data.order_number||'',order_total:formatted,customer_name:c.name||c.email},'order',data.order_id));if(c?.email&&data?.invoice_id)jobs.push(notify('invoice.created',c.email,{invoice_number:data.invoice_number||'',invoice_total:formatted,customer_name:c.name||c.email},'invoice',data.invoice_id));const mailResults=await Promise.allSettled(jobs);const mailFailures=mailResults.filter(x=>x.status==='rejected') as PromiseRejectedResult[];setBusy(false);setMsg(mailFailures.length?`Created successfully, but ${mailFailures.length} confirmation email${mailFailures.length===1?'':'s'} failed: ${mailFailures.map(x=>String(x.reason?.message||x.reason)).join('; ')}`:jobs.length?"Created successfully. Confirmation email sent.":"Created successfully.")}
 const modeHelp=mode==='invoice_only'?'Creates only an invoice. No order or order items are created.':mode==='order_only'?'Creates only an order. No invoice is created.':'Creates one linked order and invoice.';
 return <main className="adminShell billingCreatePage">
  <header className="adminTop billingCreateHeader"><div><p className="eyebrow">ORDERS & BILLING</p><h1>Create billing record</h1><p className="muted">Create an order, invoice, or a linked pair for an existing customer.</p></div><div className="inlineActions"><Link className="buttonlink secondary" href="/admin/orders">Orders</Link><Link className="buttonlink secondary" href="/admin/invoices">Invoices</Link></div></header>
  <section className="panel billingCreateCard">
   <div className="billingSetupGrid">
    <label><span>Record type</span><select value={mode} onChange={e=>{setMode(e.target.value);setCreated(undefined)}}><option value="order_invoice">Order + invoice</option><option value="order_only">Order only</option><option value="invoice_only">Invoice only</option></select><small>{modeHelp}</small></label>
    <label><span>Customer</span><select value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">Choose customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.customer_number?`${c.customer_number} · `:""}{c.name||c.email} · {c.email}</option>)}</select></label>
    <label><span>Currency</span><select value={currency} onChange={e=>setCurrency(e.target.value)}>{['AUD','USD','NZD','GBP','EUR','CAD'].map(c=><option key={c}>{c}</option>)}</select></label>
    {mode!=="order_only"&&<label><span>Due date</span><input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>}
   </div>

   <div className="billingSectionHead"><div><p className="eyebrow">LINE ITEMS</p><h2>Products & charges</h2></div><button type="button" className="secondary" onClick={()=>setLines(x=>[...x,blank()])}>+ Add line</button></div>
   <div className="billingLines">
    {lines.map((l,i)=><div className="billingLine" key={i}>
      <label className="billingProduct"><span>Product</span><select value={l.product_id} onChange={e=>pick(i,e.target.value)}><option value="">Custom item</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="billingDescription"><span>Description</span><input placeholder="Description" value={l.description} onChange={e=>patch(i,{description:e.target.value})}/></label>
      <label className="billingQty"><span>Qty</span><input type="number" min="1" value={l.quantity} onChange={e=>patch(i,{quantity:Number(e.target.value)})}/></label>
      <label className="billingPrice"><span>Unit price</span><div className="moneyInput"><span>{currency}</span><input type="number" min="0" step="0.01" value={l.unit_price} onChange={e=>patch(i,{unit_price:e.target.value})}/></div></label>
      <div className="billingLineTotal"><span>Line total</span><strong>{new Intl.NumberFormat('en-AU',{style:'currency',currency}).format((Math.max(1,Number(l.quantity)||1)*Math.round((Number(l.unit_price)||0)*100))/100)}</strong></div>
      {lines.length>1&&<button type="button" className="secondary billingRemove" onClick={()=>setLines(x=>x.filter((_,n)=>n!==i))}>Remove</button>}
    </div>)}
   </div>

   <label className="billingNotes"><span>Internal / order notes</span><textarea placeholder="Optional internal notes" value={notes} onChange={e=>setNotes(e.target.value)}/></label>
   <div className="billingCreateFooter"><div><small>Total</small><strong>{new Intl.NumberFormat('en-AU',{style:'currency',currency}).format(total/100)}</strong><span>{currency}</span></div><button type="button" onClick={create} disabled={busy}>{busy?'Creating…':mode==='order_only'?'Create order':mode==='invoice_only'?'Create invoice':'Create order + invoice'}</button></div>
   {msg&&<p className="inlineStatus">{msg}</p>}
   {created&&<div className="billingCreatedLinks">{created.order_id&&<Link className="buttonlink secondary" href={`/admin/orders/${created.order_id}`}>Open {created.order_number}</Link>}{created.invoice_id&&<Link className="buttonlink" href={`/admin/invoices/${created.invoice_id}`}>Open {created.invoice_number}</Link>}</div>}
  </section>
 </main>
}
