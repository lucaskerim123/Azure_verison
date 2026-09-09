"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

const money = (cents: number, currency = "AUD") => new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(Number(cents || 0) / 100);

export default function OrdersAndInvoices() {
  const sb = createClient();
  const [orders, setOrders] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const [o, i] = await Promise.all([
        sb.from("orders").select("id,order_number,status,payment_status,fulfillment_status,total_cents,currency,created_at").eq("auth_user_id", user.id).order("created_at", { ascending: false }),
        sb.from("invoices").select("id,invoice_number,status,total_cents,paid_cents,currency,due_at,created_at").eq("auth_user_id", user.id).order("created_at", { ascending: false }),
      ]);
      setOrders(o.data || []);
      setInvoices(i.data || []);
    })();
  }, []);

  return <main className="portalPage recordsPage">
    <header className="portalTop recordsHeader">
      <div>
        <p className="eyebrow">PURCHASES & BILLING</p>
        <h1>Orders & Invoices</h1>
        <p className="muted">Your purchases and billing records together in one place.</p>
      </div>
    </header>

    <div className="recordsSplit">
      <section className="recordsSection panel">
        <div className="recordsSectionHead">
          <div>
            <p className="eyebrow">ORDERS</p>
            <h2>Orders</h2>
            <p className="muted">Track purchase status, payment and fulfilment.</p>
          </div>
          <span className="recordsCount">{orders.length}</span>
        </div>
        <div className="recordsCompactHead"><span>Order</span><span>Status</span><span>Total</span></div>
        <div className="recordsCompactList">
          {orders.map(o => <Link className="recordCompactRow" href={`/portal/orders/${o.id}`} key={o.id}>
            <div className="recordPrimary"><b>#{o.order_number}</b><span>{new Date(o.created_at).toLocaleString()}</span></div>
            <div className="recordStatus"><span className="recordBadge">{o.status}</span><small>{o.payment_status} · {o.fulfillment_status}</small></div>
            <div className="recordAmount"><b>{money(o.total_cents, o.currency || "AUD")}</b><span>View order →</span></div>
          </Link>)}
          {!orders.length && <p className="muted recordsEmpty">No orders yet.</p>}
        </div>
      </section>

      <section className="recordsSection panel">
        <div className="recordsSectionHead">
          <div>
            <p className="eyebrow">INVOICES</p>
            <h2>Invoices</h2>
            <p className="muted">Review totals, balances and payment status.</p>
          </div>
          <span className="recordsCount">{invoices.length}</span>
        </div>
        <div className="recordsCompactHead"><span>Invoice</span><span>Status</span><span>Balance</span></div>
        <div className="recordsCompactList">
          {invoices.map(i => {
            const due = Math.max(0, Number(i.total_cents || 0) - Number(i.paid_cents || 0));
            return <Link className="recordCompactRow" href={`/portal/invoices/${i.id}`} key={i.id}>
              <div className="recordPrimary"><b>{i.invoice_number}</b><span>{i.due_at ? `Due ${new Date(i.due_at).toLocaleDateString()}` : new Date(i.created_at).toLocaleDateString()}</span></div>
              <div className="recordStatus"><span className="recordBadge">{i.status}</span><small>{money(i.total_cents, i.currency || "AUD")} total</small></div>
              <div className="recordAmount"><b>{money(due, i.currency || "AUD")}</b><span>{due > 0 ? "Amount due" : "Paid"} →</span></div>
            </Link>;
          })}
          {!invoices.length && <p className="muted recordsEmpty">No invoices yet.</p>}
        </div>
      </section>
    </div>
  </main>;
}
