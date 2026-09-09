"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import CustomerVisibleNotes from "@/components/CustomerVisibleNotes";

const money = (cents: number, currency = "AUD") => new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(Number(cents || 0) / 100);
const label = (v: any) => String(v || "—").replaceAll("_", " ");
const fmtDate = (v: any) => v ? new Date(v).toLocaleDateString("en-AU") : "—";

export default function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sb = createClient();
  const [inv, setInv] = useState<any>();
  const [items, setItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [gateways, setGateways] = useState<any[]>([]);
  const [customer, setCustomer] = useState<any>({});
  const [gateway, setGateway] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponMsg, setCouponMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [invoiceSettings, setInvoiceSettings] = useState<Record<string,any>>({});
  const [publicSettings, setPublicSettings] = useState<Record<string,any>>({});
  const [missing, setMissing] = useState(false);

  async function load() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { setMissing(true); return; }
    const a = await sb.from("invoices").select("*").eq("id", id).eq("auth_user_id", user.id).maybeSingle();
    if (!a.data) { setInv(null); setMissing(true); return; }
    const [b, c, rf, g, st, cu, pr, pst] = await Promise.all([
      sb.from("invoice_items").select("*").eq("invoice_id", id),
      sb.from("invoice_payments").select("*").eq("invoice_id", id).eq("auth_user_id", user.id).order("created_at", { ascending: false }),
      sb.from("invoice_refunds").select("*").eq("invoice_id", id).eq("auth_user_id", user.id).order("created_at", { ascending: false }),
      sb.rpc("available_payment_gateways", { p_invoice_id: id }),
      sb.from("app_settings").select("key,value").eq("category","invoice").eq("public_read",true),
      sb.from("customers").select("*").eq("auth_user_id", user.id).maybeSingle(),
      sb.from("user_profiles").select("*").eq("id", user.id).maybeSingle(),
      sb.from("app_settings").select("key,value").in("category",["identity","general","billing","site"]).eq("public_read",true),
    ]);
    setMissing(false);
    setInv(a.data);
    setItems(b.data || []);
    setPayments(c.data || []);
    setRefunds(rf.data || []);
    setGateways(g.data || []);
    setInvoiceSettings(Object.fromEntries((st.data||[]).map((x:any)=>[x.key,x.value])));
    setPublicSettings(Object.fromEntries((pst.data||[]).map((x:any)=>[x.key,x.value])));
    setCustomer({...(cu.data||{}), ...(pr.data||{}), customer_record_id: cu.data?.id || null, email: cu.data?.email || user.email || ""});
    if (!gateway && g.data?.length) setGateway(g.data[0].code);
  }

  useEffect(() => { load(); }, [id]);

  async function applyCoupon() {
    if (!coupon.trim()) return setCouponMsg("Enter a coupon code.");
    setCouponMsg("Applying coupon…");
    const { data, error } = await sb.rpc("apply_coupon_to_invoice", { p_invoice_id: id, p_coupon_code: coupon.trim() });
    setCouponMsg(error?.message || (data.settled ? `${data.code} applied — invoice fully discounted and marked paid.` : `${data.code} applied — saving ${money(data.discount_cents || 0, inv?.currency || "AUD")}.`));
    if (!error) { setCoupon(""); load(); }
  }

  async function externalHandoff(attemptId: string) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) throw new Error("Authentication expired. Please sign in again.");
    const r = await fetch("/api/payments/start", { method: "POST", headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ attempt_id: attemptId }) });
    const d = await r.json();
    if (!r.ok || !d.url) throw new Error(d.error || "Payment gateway could not start.");
    location.href = d.url;
  }

  async function pay() {
    if (!gateway) return setMsg("Choose a payment method.");
    setMsg("Starting payment…");
    const { data, error } = await sb.rpc("start_invoice_payment", { p_invoice_id: id, p_gateway_code: gateway });
    if (error) { setMsg(error.message); load(); return; }
    if (data?.status === "action_required") {
      setMsg("Opening secure payment…");
      try { await externalHandoff(data.attempt_id); } catch (e: any) { setMsg(e.message); }
      return;
    }
    setMsg(data?.status === "pending" ? (data.instructions || "Payment is pending.") : "Payment completed. Activating services…");
    load();
  }

  if (missing) return <main className="portalPage"><h1>Invoice not found</h1><p className="muted">This invoice does not belong to the signed-in customer account.</p></main>;
  if (!inv) return <main className="portalPage">Loading invoice…</main>;

  const isClosedInvoice = ["refunded","void","cancelled"].includes(String(inv.status||"").toLowerCase());
  const due = isClosedInvoice ? 0 : Math.max(0, Number(inv.total_cents || 0) - Number(inv.paid_cents || 0));
  const currency = inv.currency || "AUD";
  const presentation = {
    template: invoiceSettings["invoice.presentation_template"] || "modern",
    accent: invoiceSettings["invoice.presentation_accent"] || "#3b82f6",
    show_logo: invoiceSettings["invoice.presentation_show_logo"] ?? true,
    show_tax: invoiceSettings["invoice.presentation_show_tax"] ?? true,
    show_payment_instructions: invoiceSettings["invoice.presentation_show_payment_instructions"] ?? true,
    footer_note: invoiceSettings["invoice.footer_note"] || "Thank you for your business.",
  };

  const businessName = invoiceSettings["invoice.company_name"] || publicSettings["identity.company_name"] || "OrbitFS";
  const businessAbn = invoiceSettings["invoice.company_abn"] || "";
  const businessAddress = invoiceSettings["invoice.company_address"] || "";
  const supportEmail = publicSettings["general.support_email"] || "support@orbitfs.cc";
  const mainWebsite = publicSettings["site.website_url"] || (typeof window !== "undefined" ? window.location.origin : "https://orbitfs.vercel.app");
  const customerName = customer?.display_name || [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || "Customer";
  const customerId = customer?.customer_number || customer?.customer_record_id || inv.auth_user_id;
  const customerAddressParts = [customer?.address_line1, customer?.address_line2, customer?.city, customer?.state_region, customer?.postal_code, customer?.country_code].filter(Boolean);
  const latestPayment = payments.find((p:any) => ["completed","paid","succeeded"].includes(String(p.status||"").toLowerCase())) || payments[0];
  const refundTotal=refunds.filter((r:any)=>["pending","processing","completed","succeeded"].includes(String(r.status||"").toLowerCase())).reduce((n:number,r:any)=>n+Number(r.amount_cents||0),0);
  const history=[...payments.map((p:any)=>({...p,kind:"payment"})),...refunds.map((r:any)=>({...r,kind:"refund"}))].sort((a:any,b:any)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime());

  return <main className={`portalPage recordDetailPage invoicePresentation invoiceTemplate-${presentation.template}`} style={{"--invoice-accent":presentation.accent} as any}>
    <header className="recordDetailHero">
      <div>{presentation.show_logo&&<div className="invoiceCustomerBrand">OrbitFS</div>}<p className="eyebrow">INVOICE</p><h1>{inv.invoice_number}</h1><p className="muted">Created {new Date(inv.created_at).toLocaleString()} · {inv.due_at ? `Due ${new Date(inv.due_at).toLocaleDateString()}` : "No due date"}</p></div>
      <Link className="ghostbtn" href="/portal/orders">← Orders & Invoices</Link>
    </header>

    <section className="recordSummaryGrid">
      <article><small>Invoice status</small><strong>{label(inv.status)}</strong></article>
      <article><small>Total</small><strong>{money(inv.total_cents, currency)}</strong></article>
      <article><small>Paid</small><strong>{money(inv.paid_cents || 0, currency)}</strong>{refundTotal>0&&<span className="muted">Refunded {money(refundTotal,currency)}</span>}</article>
      <article><small>Amount due</small><strong>{money(due, currency)}</strong></article>
    </section>

    <div className="recordDetailGrid">
      <section className="panel recordProductsPanel invoiceDocumentPanel">
        <div className="invoiceDocument">
          <div className="invoiceDocHeader">
            <div className="invoiceDocBusiness">
              <strong>{businessName}</strong>
              {supportEmail && <span>{supportEmail}</span>}
              {mainWebsite && <span>{mainWebsite}</span>}
              {businessAbn && <span><b>ABN / Business No.</b> {businessAbn}</span>}
              {businessAddress && <span>{businessAddress}</span>}
            </div>
            <div className="invoiceDocMeta">
              <h2>INVOICE</h2>
              <span><b>Invoice #</b> {inv.invoice_number}</span>
              <span><b>Date</b> {fmtDate(inv.created_at)}</span>
              <span><b>Due</b> {fmtDate(inv.due_at)}</span>
              <span><b>Status</b> {label(inv.status)}</span>
            </div>
          </div>

          <div className="invoiceDocBillTo">
            <p className="invoiceDocLabel">BILL TO</p>
            <strong>{customerName}</strong>
            {customerId && <span><b>Customer ID:</b> {customerId}</span>}
            {customer?.company_name && <span><b>Company:</b> {customer.company_name}</span>}
            {customer?.email && <span>{customer.email}</span>}
            {customer?.phone && <span><b>Phone:</b> {customer.phone}</span>}
            {customerAddressParts.length > 0 && <span><b>Billing address:</b> {customerAddressParts.join(", ")}</span>}
          </div>

          <div className="invoiceDocItems">
            <div className="invoiceDocItemHead"><span>DESCRIPTION</span><span>QTY</span><span>UNIT PRICE</span><span>AMOUNT</span></div>
            {items.map(x => <div className="invoiceDocItemRow" key={x.id}><div><b>{x.description}</b></div><span>{x.quantity || 1}</span><span>{money(x.unit_price_cents, currency)}</span><strong>{money(x.total_cents, currency)}</strong></div>)}
          </div>

          <div className="invoiceDocTotals">
            <div><span>Subtotal</span><strong>{money(inv.subtotal_cents, currency)}</strong></div>
            {presentation.show_tax && <div><span>{publicSettings["billing.tax_name"] || "Tax"}</span><strong>{money(inv.tax_cents || 0, currency)}</strong></div>}
            {Number(inv.discount_cents || 0) > 0 && <div><span>Discount</span><strong>-{money(inv.discount_cents, currency)}</strong></div>}
            <div className="invoiceDocTotalMain"><span>TOTAL</span><strong>{money(inv.total_cents, currency)}</strong></div>
            <div><span>Paid</span><strong>{money(inv.paid_cents || 0, currency)}</strong></div>
            {refundTotal>0&&<div><span>Refunded / processing</span><strong>-{money(refundTotal,currency)}</strong></div>}
            <div><span>Balance</span><strong>{money(due, currency)}</strong></div>
          </div>

          <div className="invoiceDocPaymentDetails">
            <p className="invoiceDocLabel">PAYMENT DETAILS</p>
            <div><span>Payment Method</span><strong>{latestPayment ? label(latestPayment.method) : "—"}</strong></div>
            <div><span>Payment Reference</span><strong>{latestPayment?.external_reference || "—"}</strong></div>
            <div><span>Payment Date</span><strong>{latestPayment ? fmtDate(latestPayment.created_at) : "—"}</strong></div>
          </div>

          <div className="invoiceDocFooter">
            <strong>{presentation.footer_note}</strong>
            {supportEmail && <span>Questions about this invoice? Contact {supportEmail}</span>}
            {mainWebsite && <span>{mainWebsite}</span>}
            <span>{businessName}</span>
          </div>
        </div>
      </section>

      <section className="panel recordLinkedPanel">
        <p className="eyebrow">RELATED ORDER</p><h2>Order</h2>
        {inv.order_id ? <Link className="linkedRecordCard" href={`/portal/orders/${inv.order_id}`}><div><b>View linked order</b><span>Purchase and fulfilment details</span></div><div><span>Open order →</span></div></Link> : <p className="muted">No order linked.</p>}
      </section>

      <section className="panel recordPaymentPanel">
        <p className="eyebrow">PAYMENT</p><h2>{inv.status==="refunded" ? "Invoice refunded" : due > 0 ? "Pay invoice" : "Payment complete"}</h2>
        {due > 0 && !isClosedInvoice ? <div className="form">
          <label>Coupon code<div className="couponApply"><input value={coupon} onChange={e => setCoupon(e.target.value.toUpperCase())} placeholder="Enter coupon code"/><button type="button" className="secondary" onClick={applyCoupon}>Apply</button></div></label>
          {!!couponMsg && <small>{couponMsg}</small>}
          <label>Payment method<select value={gateway} onChange={e => setGateway(e.target.value)}><option value="">Choose payment method</option>{gateways.map((g: any) => <option value={g.code} key={g.code}>{g.name}</option>)}</select><small>{gateways.find((g: any) => g.code === gateway)?.description || "Choose how you want to pay this invoice."}</small></label>
          <button onClick={pay} disabled={!gateway}>Pay {money(due, currency)}</button>
          {presentation.show_payment_instructions&&gateways.find((g: any) => g.code === gateway)?.instructions && <div className="notice"><b>Payment instructions</b><span>{gateways.find((g: any) => g.code === gateway)?.instructions}</span></div>}
        </div> : <div className="notice successNotice"><b>{inv.status==="refunded"?"Refund completed":"No balance due"}</b><span>{inv.status==="refunded"?"All money received for this invoice has been refunded. This invoice is closed and no further payment is required.":"This invoice does not currently require payment."}</span></div>}
        {!!msg && <p className="muted">{msg}</p>}
      </section>

      <CustomerVisibleNotes entityType="invoice" entityId={id} title="Invoice notes" />

      <section className="panel recordWide">
        <p className="eyebrow">HISTORY</p><h2>Payment & refund history</h2>
        {history.length ? history.map((entry:any) => entry.kind==="refund"?<div className="paymentHistoryRow" key={`r-${entry.id}`}><div><b>{["completed","succeeded"].includes(String(entry.status).toLowerCase())?"Refunded":"Refund processing"}</b><span>{label(entry.method)}{entry.external_reference?` · ${entry.external_reference}`:""} · {new Date(entry.created_at).toLocaleString()}</span>{entry.reason&&<span>{entry.reason}</span>}</div><div><strong>-{money(entry.amount_cents, currency)}</strong><span>{label(entry.status)}</span></div></div>:<div className="paymentHistoryRow" key={`p-${entry.id}`}><div><b>Payment received</b><span>{label(entry.method)} · {entry.external_reference || "No reference"} · {new Date(entry.created_at).toLocaleString()}</span></div><div><strong>{money(entry.amount_cents, currency)}</strong><span>{label(entry.status)}</span></div></div>) : <p className="muted">No payments or refunds recorded.</p>}
      </section>
    </div>
  </main>;
}