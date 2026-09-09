"use client";
import {use,useEffect,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import InvoiceAdminTabs from "@/components/InvoiceAdminTabs";
import AdminNotesPanel from "@/components/AdminNotesPanel";

export default function InvoiceNotes({params}:{params:Promise<{id:string}>}){
 const {id}=use(params),sb=createClient();
 const [inv,setInv]=useState<any>();
 useEffect(()=>{sb.from("invoices").select("id,invoice_number,auth_user_id,order_id,status,total_cents,currency").eq("id",id).single().then(({data})=>setInv(data))},[id]);
 if(!inv)return <main className="adminShell">Loading invoice notes…</main>;
 return <main className="adminShell invoiceAdminPage"><header className="adminTop"><div><p className="eyebrow">INVOICE NOTES</p><h1>{inv.invoice_number}</h1><p className="muted">Staff-only and customer-visible notes are kept separately from the billing overview.{!inv.order_id?" This is a standalone invoice with no linked order.":""}</p></div><div className="inlineActions"><Link href={`/admin/customers/${inv.auth_user_id}`}>Open customer →</Link>{inv.order_id&&<Link href={`/admin/orders/${inv.order_id}`}>Open order →</Link>}</div></header>
 <InvoiceAdminTabs invoiceId={id}/>
 <section className="invoiceContextBar"><div><small>Status</small><b>{inv.status}</b></div><div><small>Total</small><b>${(Number(inv.total_cents||0)/100).toFixed(2)} {inv.currency||"AUD"}</b></div></section>
 <AdminNotesPanel entityType="invoice" entityId={id} title="Invoice notes"/>
 </main>;
}
