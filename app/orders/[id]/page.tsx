import { getCatalogItem } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { fromCents } from "@/lib/money";
import { getOrderRow } from "@/lib/paypal/checkout";
import { claimsForOrder } from "@/lib/verifier/run";
import { SubmitButton } from "../../submit-button";
import { ClaimForm } from "./claim-form";

export const dynamic = "force-dynamic";

const CLAIM_STATUS: Record<string, { label: string; tone: "ok" | "wait" | "no" }> = {
  verifying: { label: "Checking", tone: "wait" },
  approved: { label: "Approved", tone: "ok" },
  refunded: { label: "Refunded", tone: "ok" },
  refused: { label: "Not approved", tone: "no" },
  needs_review: { label: "With a person", tone: "wait" },
  refund_unknown: { label: "Confirming with PayPal", tone: "wait" },
  refund_failed: { label: "Refund failed", tone: "no" },
};

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { id } = await params;
  const { notice } = await searchParams;
  const order = getOrderRow(id);
  if (!order) {
    return (
      <main className="shell">
        <div className="page-head"><a className="back" href="/">← Store</a><h1>Order not found</h1></div>
      </main>
    );
  }
  const product = getCatalogItem(order.product_id);
  const refunds = getDb().prepare("SELECT claim_id, refund_id, amount_cents, status FROM refunds WHERE order_id = ?").all(id) as {
    claim_id: string; refund_id: string | null; amount_cents: number; status: string;
  }[];
  const claims = claimsForOrder(id);
  const paid = order.status === "captured";
  const refunded = refunds.find((r) => r.status === "completed");

  const steps = [
    { label: "Order placed", sub: "PayPal checkout opened", done: true },
    { label: "Paid with PayPal", sub: paid ? `$${fromCents(order.captured_cents!)} captured` : "Waiting for your approval on PayPal", done: paid },
    { label: "Price match checked", sub: claims.length ? `${claims.length} claim${claims.length > 1 ? "s" : ""} checked` : "Found it cheaper? Paste the link", done: claims.some((c) => c.status !== "verifying") },
    { label: "Difference refunded", sub: refunded ? `$${fromCents(refunded.amount_cents)} back to your PayPal` : "Only after a verified claim", done: Boolean(refunded) },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <main className="shell">
      <div className="page-head">
        <a className="back" href="/">← Store</a>
        <h1 className="rise">Your order</h1>
      </div>
      {notice && <p className="notice notice-warn" role="status" style={{ marginTop: 0, marginBottom: 18 }}>{notice}</p>}

      <div className="two-col">
        <section className="card card-pad rise" style={{ ["--i" as string]: 1 }}>
          <div className="receipt-top">
            <div className="receipt-thumb">{product?.image_url && <img src={product.image_url} alt="" />}</div>
            <div style={{ display: "grid", gap: 6 }}>
              <strong style={{ fontSize: 16, lineHeight: 1.35 }}>{product?.title}</strong>
              <span className={`status ${paid ? "status-ok" : "status-wait"}`}>{paid ? "Paid" : "Awaiting payment"}</span>
            </div>
          </div>
          <dl className="kv">
            <dt>{paid ? "Paid" : "Amount"}</dt>
            <dd><strong>${fromCents(order.captured_cents ?? order.amount_cents)}</strong> {order.currency}</dd>
            <dt>PayPal order</dt><dd className="mono">{order.paypal_order_id ?? "—"}</dd>
            <dt>PayPal capture</dt><dd className="mono">{order.capture_id ?? "—"}</dd>
            {refunded && (<><dt>Refunded</dt><dd style={{ color: "var(--accent)", fontWeight: 650 }}>${fromCents(refunded.amount_cents)}</dd></>)}
          </dl>
          <ol className="timeline" aria-label="Order progress">
            {steps.map((s, i) => (
              <li key={s.label} className={s.done ? "done" : i === current ? "current" : ""} style={{ ["--i" as string]: i }}>
                <span className="t-dot">{s.done ? <Check /> : i + 1}</span>
                <span><span className="t-label">{s.label}</span><br /><span className="t-sub">{s.sub}</span></span>
              </li>
            ))}
          </ol>
        </section>

        <div style={{ display: "grid", gap: 20 }}>
          {!paid && (
            <section className="card card-pad rise" style={{ ["--i" as string]: 2 }}>
              <h2 style={{ fontSize: 20 }}>Finished paying on PayPal?</h2>
              <p className="muted" style={{ margin: "8px 0 0", fontSize: 15 }}>If PayPal didn&apos;t bring you back here, check the payment now.</p>
              <form action="/checkout/return" method="get" style={{ marginTop: 14 }}>
                <input type="hidden" name="order" value={order.id} />
                <SubmitButton pendingLabel="Checking with PayPal" className="btn btn-ghost">Check payment</SubmitButton>
              </form>
            </section>
          )}

          {paid && !refunded && (
            <section className="card card-pad claim-card rise" style={{ ["--i" as string]: 2 }}>
              <span className="eyebrow">Price-match guarantee</span>
              <h2 style={{ marginTop: 8 }}>Found it cheaper?</h2>
              <ClaimForm orderId={order.id} />
              <ol className="how">
                <li><span className="n">1</span>Channel3 reads the offer: price, stock and condition. Sent a screenshot? AI reads it first.</li>
                <li><span className="n">2</span>AI confirms it is the same product, not a bundle or another model.</li>
                <li><span className="n">3</span>If it qualifies, PayPal refunds the difference to you.</li>
              </ol>
            </section>
          )}

          {claims.length > 0 && (
            <section className="card card-pad rise" style={{ ["--i" as string]: 3 }}>
              <h2 style={{ fontSize: 20 }}>Claims</h2>
              <ul className="list">
                {claims.map((c) => {
                  const s = CLAIM_STATUS[c.status] ?? { label: c.status, tone: "wait" as const };
                  return (
                    <li key={c.id}>
                      <a href={`/claims/${c.id}`}>
                        <span style={{ overflowWrap: "anywhere" }}>
                          {c.source === "image" ? `Screenshot${c.competitor_domain ? ` · ${c.competitor_domain}` : ""}` : new URL(c.competitor_url).hostname.replace(/^www\./, "")}
                        </span>
                        <span className={`status status-${s.tone}`}>{s.label}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
