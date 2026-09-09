"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";

export default function InvoiceAdminTabs({invoiceId}:{invoiceId:string}){
 const path=usePathname();
 const tabs=[
  ["Overview",`/admin/invoices/${invoiceId}`],
  ["Payments",`/admin/invoices/${invoiceId}/payments`],
  ["Refund",`/admin/invoices/${invoiceId}/refund`],
  ["Notes",`/admin/invoices/${invoiceId}/notes`],
 ];
 return <nav className="invoiceTabs">{tabs.map(([label,href])=><Link key={href} className={path===href?'active':''} href={href}>{label}</Link>)}</nav>;
}
