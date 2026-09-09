"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import CustomerVisibleNotes from "@/components/CustomerVisibleNotes";
import {trackCustomerActivity} from "@/lib/customer-activity";

const money = (cents: number, currency = "AUD") => new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(Number(cents || 0) / 100);
const label = (v: any) => String(v || "—").replaceAll("_", " ");

export default function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sb = createClient();
  const [o, setO] = useState<any>();
  const [items, setItems] = useState<any[]>([]);
  const [inv, setInv] = useState<any>();
  const [cancel, setCancel] = useState<any>();
  const [cancelCtx, setCancelCtx] = useState<any>({});
  const [cancelTiming, setCancelTiming] = useState("immediate");
  const [refundPreference, setRefundPreference] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [missing, setMissing] = useState(false);

  async function load() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { setMissing(true); return; }
    const a = await sb.from("orders").select("*").eq("id", id).eq("auth_user_id", user.id).maybeSingle();
    if (!a.data) { setO(null); setMissing(true); return; }
    const [b, c, d] = await Promise.all([
      sb.from("order_items").select("*").eq("order_id", id),
      sb.from("invoices").select("*").eq("order_id", id).eq("auth_user_id", user.id).maybeSingle(),
      sb.rpc("customer_order_cancellation_context", { p_order_id: id }),
    ]);
    setMissing(false); setO(a.data); setItems(b.data || []); setInv(c.data); setCancel(d.data?.request); setCancelCtx(d.data || {});
    if(!d.data?.can_end_of_cycle) setCancelTiming("immediate");
    if(d.data?.request?.refund_preference)setRefundPreference(d.data.request.refund_preference);
    else if(!d.data?.refund_required)setRefundPreference("");
  }

  useEffect(() => { load(); }, [id]);

  async function requestCancel() {
    if (!reason.trim()) return setMsg("Enter a cancellation reason.");
    if(cancelCtx.refund_required&&!refundPreference)return setMsg("Choose where the partial payment should be refunded.");
    if(cancelCtx.refund_required){
      const amount=money(cancelCtx.refund_amount_cents||0,cancelCtx.invoice?.currency||o.currency||"AUD");
      const destination=refundPreference==="wallet"?"your OrbitFS Wallet":"the original payment method(s)";
      const warning=refundPreference==="original"?" Original card or PayPal refunds may not appear instantly and can take time to clear through the payment provider or bank.":" Wallet credit is normally available immediately once the cancellation is approved.";
      if(!confirm(`Submit this cancellation request and automatically refund ${amount} to ${destination} if approved?${warning}`))return;
    }
    const { error } = await sb.rpc("request_order_cancellation_v2", { p_order_id: id, p_reason: reason, p_timing: cancelTiming, p_refund_preference: refundPreference || null });
    setMsg(error?.message || "Cancellation request submitted for review.");
    if (!error) { await trackCustomerActivity("service.cancellation_requested",{entityType:"order",entityId:id,detail:{timing:cancelTiming,refund_preference:refundPreference||null}}); setReason(""); load(); }
  }

  if (missing) return <main className="portalPage"><h1>Order not found</h1><p className="muted">This order does not belong to the signed-in customer account.</p></main>;
  if (!o) return <main className="portalPage">Loading order…</main>;

  return <main className="portalPage recordDetailPage">
    <header className="recordDetailHero">
      <div>
        <p className="eyebrow">ORDER</p>
        <h1>Order #{o.order_number}</h1>
        <p className="muted">Placed {new Date(o.created_at).toLocaleString()}</p>
      </div>
      <Link className="ghostbtn" href="/portal/orders">← Orders & Invoices</Link>
    </header>

    <section className="recordSummaryGrid">
      <article><small>Order status</small><strong>{label(o.status)}</strong></article>
      <article><small>Payment</small><strong>{label(o.payment_status)}</strong></article>
      <article><small>Fulfilment</small><strong>{label(o.fulfillment_status)}</strong></article>
      <article><small>Order total</small><strong>{money(o.total_cents, o.currency || "AUD")}</strong></article>
    </section>

    <div className="recordDetailGrid">
      <section className="panel recordProductsPanel">
        <div className="panelTitle"><div><p className="eyebrow">PURCHASED</p><h2>Products</h2></div><span>{items.length} item{items.length === 1 ? "" : "s"}</span></div>
        <div className="recordProductList">
          {items.map(i => <div className="recordProductRow" key={i.id}>
            <div><b>{i.product_name}</b>{Number(i.quantity || 1) > 1 && <small>Quantity {i.quantity}</small>}</div>
            <strong>{money(i.total_cents, o.currency || "AUD")}</strong>
          </div>)}
          {!items.length && <p className="muted">No products recorded.</p>}
        </div>
      </section>

      <section className="panel recordLinkedPanel">
        <p className="eyebrow">BILLING</p><h2>Invoice</h2>
        {inv ? <Link className="linkedRecordCard" href={`/portal/invoices/${inv.id}`}>
          <div><b>{inv.invoice_number}</b><span>{label(inv.status)}</span></div>
          <div><strong>{money(inv.total_cents, inv.currency || o.currency || "AUD")}</strong><span>View invoice →</span></div>
        </Link> : <p className="muted">No invoice linked to this order.</p>}
      </section>

      {o.metadata?.provisioning_error && <section className="panel recordWide"><p className="eyebrow">ACTIVATION</p><h2>Service activation</h2><div className="notice"><b>Paid — activation is waiting</b><span>{o.metadata.provisioning_error}</span></div></section>}

      <CustomerVisibleNotes entityType="order" entityId={id} title="Order notes" />

      <section className="panel recordWide">
        <p className="eyebrow">SERVICE CONTROL</p><h2>Cancel service</h2>
        {cancel&&["requested","approved_scheduled"].includes(cancel.status)?<div className="notice"><b>{label(cancel.status)}</b><span>{cancel.reason}</span><small>Requested: {label(cancel.requested_timing)}{cancel.scheduled_for?` · service ends ${new Date(cancel.scheduled_for).toLocaleString()}`:""}</small>{cancel.refund_amount_cents>0&&<small>Refund: {money(cancel.refund_amount_cents,cancelCtx.invoice?.currency||o.currency||"AUD")} → {cancel.refund_preference==="wallet"?"OrbitFS Wallet":"original payment method(s)"} · {label(cancel.refund_status)}</small>}{cancel.refund_last_error&&<small>Refund issue: {cancel.refund_last_error}</small>}{cancel.staff_note&&<small>Staff note: {cancel.staff_note}</small>}</div>:!["cancelled","terminated"].includes(o.status)?<div className="form recordCancelForm">
          <p className="muted">Choose when you want this service to end. Cancellation requests are reviewed by OrbitFS staff before they take effect.</p>
          <div className="cancelTimingOptions"><label><input type="radio" name="cancelTiming" checked={cancelTiming==="immediate"} onChange={()=>setCancelTiming("immediate")}/><span><b>Immediately</b><small>Terminate the service as soon as the request is approved.</small></span></label>{cancelCtx.can_end_of_cycle&&!cancelCtx.refund_required&&<label><input type="radio" name="cancelTiming" checked={cancelTiming==="end_of_cycle"} onChange={()=>setCancelTiming("end_of_cycle")}/><span><b>End of billing cycle</b><small>Keep service active until {cancelCtx.subscription?.next_charge_at?new Date(cancelCtx.subscription.next_charge_at).toLocaleString():"the current billing period ends"}.</small></span></label>}</div>
          {cancelCtx.refund_required&&<div className="notice" style={{display:"grid",gap:10}}><div><b>Partial payment refund</b><span>This order has not been activated and {money(cancelCtx.refund_amount_cents||0,cancelCtx.invoice?.currency||o.currency||"AUD")} has already been paid. Choose where that amount should be returned if the cancellation is approved.</span></div><div className="cancelTimingOptions"><label><input type="radio" name="refundPreference" checked={refundPreference==="wallet"} onChange={()=>setRefundPreference("wallet")}/><span><b>Refund to OrbitFS Wallet</b><small>Returns the refundable amount as account credit. This is normally available immediately once processed.</small></span></label><label><input type="radio" name="refundPreference" checked={refundPreference==="original"} disabled={!cancelCtx.can_refund_original} onChange={()=>setRefundPreference("original")}/><span><b>Refund to original payment method(s)</b><small>Wallet-paid portions return to Wallet. Card/Stripe and PayPal refunds are sent back through the original provider and may not appear instantly.</small></span></label></div>{!cancelCtx.can_refund_original&&<small>Original-method refund is unavailable for the recorded payment. Choose OrbitFS Wallet.</small>}</div>}
          <textarea rows={4} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Tell us why you want to cancel this service."/>
          <button className="danger" onClick={requestCancel}>Submit cancellation request</button>
          {cancel?.status==="denied"&&<small>Previous request was denied{cancel.staff_note?`: ${cancel.staff_note}`:""}. You may submit a new request.</small>}
        </div>:<p className="muted">This service has been terminated.</p>}
        {!!msg&&<p className="muted">{msg}</p>}
      </section>
    </div>
  </main>;
}
