"use client";

import {useEffect,useMemo,useState} from "react";
import {usePathname} from "next/navigation";
import {createClient} from "@/lib/supabase";
import styles from "./AdminRecordQuickSend.module.css";

const AUTO=new Set(["customer_name","email_refrence_id","email_reference_id","staff_name","staff_email","staff_user_id"]);
const money=(n:any,c="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency:c}).format(Number(n||0)/100);
const varsIn=(v:any)=>[...new Set([...String(v||"").matchAll(/{{\s*([\w.]+)\s*}}/g)].map(x=>String(x[1]).toLowerCase()))];
const pretty=(v:string)=>String(v||"").replaceAll("_"," ").replace(/\b\w/g,x=>x.toUpperCase());
const fieldLabel=(v:string)=>({invoice_number:"Invoice number",invoice_total:"Invoice total",invoice_due:"Amount due",due_date:"Due date",invoice_url:"Invoice URL",refund_amount:"Refund amount",refund_method:"Refund method",refund_status:"Refund status",refund_reference:"Refund reference",refund_timing:"Refund timing",order_number:"Order number",order_total:"Order total",product_name:"Product / service",reason:"Reason",staff_note:"Staff note",scheduled_for:"Scheduled for",message:"Message"} as Record<string,string>)[v]||pretty(v);
const longField=(v:string)=>["message","reason","staff_note","refund_timing","reply_preview"].includes(v);
const render=(v:any,values:Record<string,string>)=>String(v||"").replace(/\\n/g,"\n").replace(/{{\s*([\w.]+)\s*}}/g,(_,k)=>values[String(k).toLowerCase()]??`{{${k}}}`);

type Scope="invoice"|"order";

export default function AdminRecordQuickSend(){
 const path=usePathname(),sb=createClient();
 const match=path.match(/^\/admin\/(invoices|orders)\/([^/]+)$/);
 const scope=(match?.[1]==="invoices"?"invoice":match?.[1]==="orders"?"order":null) as Scope|null;
 const recordId=match?.[2]||"";
 const [loading,setLoading]=useState(false),[templates,setTemplates]=useState<any[]>([]),[templateKey,setTemplateKey]=useState(""),[baseVars,setBaseVars]=useState<Record<string,string>>({}),[values,setValues]=useState<Record<string,string>>({}),[customerName,setCustomerName]=useState("Customer"),[email,setEmail]=useState(""),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);

 useEffect(()=>{if(!scope||!recordId)return;let dead=false;(async()=>{
  setLoading(true);setMsg("");setTemplates([]);setTemplateKey("");
  const {data:{session}}=await sb.auth.getSession();if(!session?.access_token){if(!dead)setLoading(false);return}
  let userId="",name="Customer",prefill:Record<string,string>={},preferred="";
  if(scope==="invoice"){
   const {data:inv}=await sb.from("invoices").select("*").eq("id",recordId).maybeSingle();if(!inv){if(!dead)setLoading(false);return}
   userId=String(inv.auth_user_id||"");const currency=inv.currency||"AUD",closed=["refunded","cancelled","void"].includes(String(inv.status||"").toLowerCase()),due=closed?0:Math.max(0,Number(inv.total_cents||0)-Number(inv.paid_cents||0));
   const [pr,cu,rf,ord]=await Promise.all([sb.from("user_profiles").select("display_name,first_name,last_name").eq("id",userId).maybeSingle(),sb.from("customers").select("display_name,first_name,last_name").eq("auth_user_id",userId).maybeSingle(),sb.from("invoice_refunds").select("*").eq("invoice_id",recordId).order("created_at",{ascending:false}).limit(1).maybeSingle(),inv.order_id?sb.from("orders").select("order_number").eq("id",inv.order_id).maybeSingle():Promise.resolve({data:null} as any)]);
   name=pr.data?.display_name||cu.data?.display_name||[pr.data?.first_name||cu.data?.first_name,pr.data?.last_name||cu.data?.last_name].filter(Boolean).join(" ")||"Customer";
   const refund=rf.data,method=String(refund?.method||"");
   prefill={invoice_number:String(inv.invoice_number||""),invoice_total:money(inv.total_cents,currency),invoice_due:money(due,currency),due_date:inv.due_at?new Date(inv.due_at).toLocaleDateString("en-AU"):"",invoice_url:`${location.origin}/portal/invoices/${recordId}`,order_number:String(ord.data?.order_number||""),refund_amount:refund?money(refund.amount_cents,currency):"",refund_method:method?pretty(method):"",refund_status:refund?.status?pretty(refund.status):"",refund_reference:String(refund?.external_reference||refund?.provider_reference||""),refund_timing:refund?(method.includes("wallet")||method.includes("credit")?"OrbitFS Wallet refunds are normally available once the refund is completed.":"External payment refunds can take several business days to appear, depending on the payment provider and bank."):""};
   const status=String(inv.status||"").toLowerCase();preferred=status==="refunded"?"invoice_refund":status==="paid"?"invoice_paid":status==="overdue"?"invoice_overdue":["cancelled","void"].includes(status)?"invoice_cancelled":"invoice_created";
  }else{
   const {data:ord}=await sb.from("orders").select("*").eq("id",recordId).maybeSingle();if(!ord){if(!dead)setLoading(false);return}
   userId=String(ord.auth_user_id||"");const currency=ord.currency||"AUD";
   const [pr,cu,it]=await Promise.all([sb.from("user_profiles").select("display_name,first_name,last_name").eq("id",userId).maybeSingle(),sb.from("customers").select("display_name,first_name,last_name").eq("auth_user_id",userId).maybeSingle(),sb.from("order_items").select("product_name").eq("order_id",recordId).order("product_name")]);
   name=pr.data?.display_name||cu.data?.display_name||[pr.data?.first_name||cu.data?.first_name,pr.data?.last_name||cu.data?.last_name].filter(Boolean).join(" ")||"Customer";
   prefill={order_number:String(ord.order_number||""),order_total:money(ord.total_cents,currency),product_name:(it.data||[]).map((x:any)=>x.product_name).filter(Boolean).join(", "),reason:"",staff_note:"",scheduled_for:""};
   const status=String(ord.status||"").toLowerCase(),service=String(ord.service_status||"").toLowerCase(),payment=String(ord.payment_status||"").toLowerCase();preferred=status==="terminated"||service==="terminated"?"cancellation_completed":service==="active"?"service_activated":payment.startsWith("paid")?"order_paid":"order_created";
  }
  if(!userId){if(!dead)setLoading(false);return}
  const r=await fetch(`/api/admin/customer-email?userId=${encodeURIComponent(userId)}&scope=${scope}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});const j=await r.json().catch(()=>({}));
  if(dead)return;const list=r.ok?(j.templates||[]):[];setCustomerName(name);setEmail(j.email||"");setBaseVars(prefill);setValues(prefill);setTemplates(list);const chosen=list.find((x:any)=>x.template_key===preferred)?.template_key||list[0]?.template_key||"";setTemplateKey(chosen);setLoading(false);
 })();return()=>{dead=true}},[scope,recordId]);

 const selected=useMemo(()=>templates.find(x=>x.template_key===templateKey),[templates,templateKey]);
 const required=useMemo(()=>selected?[...new Set([...varsIn(selected.subject),...varsIn(selected.text_body),...varsIn(selected.html)])].filter(v=>!AUTO.has(v)):[],[selected]);
 const previewVars={...values,customer_name:customerName,email_reference_id:"generated on send",email_refrence_id:"generated on send",staff_name:"Current staff",staff_email:"Current staff email",staff_user_id:"current staff"};
 const subject=selected?render(selected.subject,previewVars):"",body=selected?render(selected.text_body||selected.subject,previewVars):"";
 function choose(key:string){setTemplateKey(key);setValues({...baseVars});setMsg("")}
 async function send(){if(!scope||!recordId||!selected)return;const missing=required.filter(v=>!String(values[v]||"").trim());if(missing.length)return setMsg(`Complete: ${missing.map(fieldLabel).join(", ")}.`);const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)return setMsg("Authentication expired.");setBusy(true);setMsg("Sending…");const userId=scope==="invoice"?(await sb.from("invoices").select("auth_user_id").eq("id",recordId).single()).data?.auth_user_id:(await sb.from("orders").select("auth_user_id").eq("id",recordId).single()).data?.auth_user_id;const r=await fetch("/api/admin/customer-email",{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({userId,customerName,templateKey:selected.template_key,variables:values,relatedType:scope,relatedId:recordId,eventType:`admin.quick_send.${scope}`})});const j=await r.json().catch(()=>({}));setBusy(false);setMsg(r.ok?`Sent to ${email}${j.reference_id?` · ${j.reference_id}`:""}.`:j.error||"Email failed.")}
 if(!scope)return null;
 return <div className={styles.shell}><details className={`panel ${styles.panel}`} open><summary><span><b>Quick Send Email</b><small>{scope==="invoice"?"Invoice":"Order"} templates · prefilled from this record</small></span><span>{email||"Customer email"}</span></summary>{loading?<p className={styles.note}>Loading email templates…</p>:templates.length?<div className={styles.body}><div className={styles.top}><label>Template<select value={templateKey} onChange={e=>choose(e.target.value)}>{templates.map(t=><option key={t.template_key} value={t.template_key}>{t.category} · {t.name}</option>)}</select></label><div className={styles.sender}><span>From</span><b>{selected?.from_account||"OrbitFS Mail"}</b></div></div>{required.length>0&&<div className={styles.fields}>{required.map(v=><label key={v}>{fieldLabel(v)}{longField(v)?<textarea rows={v==="refund_timing"?2:3} value={values[v]||""} onChange={e=>setValues({...values,[v]:e.target.value})}/>:<input type={v==="scheduled_for"?"datetime-local":"text"} value={values[v]||""} onChange={e=>setValues({...values,[v]:e.target.value})}/>}</label>)}</div>}<div className={styles.preview}><div><span>Subject</span><b>{subject||"—"}</b></div><div><span>Preview</span><p>{body||"—"}</p></div></div><div className={styles.actions}><span className={styles.note}>{msg}</span><button onClick={send} disabled={busy||!templateKey||!email}>{busy?"Sending…":`Send ${scope} email`}</button></div></div>:<p className={styles.note}>No {scope} email templates are enabled.</p>}</details></div>;
}
