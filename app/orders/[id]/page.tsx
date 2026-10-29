import { getCatalogItem } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { fromCents } from "@/lib/money";
import { getOrderRow } from "@/lib/paypal/checkout";
import { claimsForOrder } from "@/lib/verifier/run";
import { SubmitButton } from "../../submit-button";
import { ClaimForm } from "./claim-form";
import { requestPrefs } from "@/lib/locale-server";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "ok" | "wait" | "no"> = {
  verifying: "wait", approved: "ok", refunded: "ok", refused: "no", needs_review: "wait", refund_unknown: "wait", refund_failed: "no",
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
  const { t: tt } = await requestPrefs();
  const t = tt.order;
  const order = getOrderRow(id);
  if (!order) {
    return (
      <main className="shell">
        <div className="page-head"><a className="back" href="/">{t.back}</a><h1>{t.notFound}</h1></div>
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
    { label: t.s1, sub: t.s1sub, done: true },
    { label: t.s2, sub: paid ? t.s2subDone(`$${fromCents(order.captured_cents!)}`) : t.s2subWait, done: paid },
    { label: t.s3, sub: claims.length ? t.s3subDone(claims.length) : t.s3subWait, done: claims.some((c) => c.status !== "verifying") },
    { label: t.s4, sub: refunded ? t.s4subDone(`$${fromCents(refunded.amount_cents)}`) : t.s4subWait, done: Boolean(refunded) },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <main className="shell">
      <div className="page-head">
        <a className="back" href="/">{t.back}</a>
        <h1 className="rise">{t.title}</h1>
      </div>
      {notice && <p className="notice notice-warn" role="status" style={{ marginTop: 0, marginBottom: 18 }}>{notice}</p>}

      <div className="two-col">
        <section className="card card-pad rise" style={{ ["--i" as string]: 1 }}>
          <div className="receipt-top">
            <div className="receipt-thumb">{product?.image_url && <img src={product.image_url} alt="" />}</div>
            <div style={{ display: "grid", gap: 6 }}>
              <strong style={{ fontSize: 16, lineHeight: 1.35 }}>{product?.title}</strong>
              <span className={`status ${paid ? "status-ok" : "status-wait"}`}>{paid ? t.paid : t.awaiting}</span>
            </div>
          </div>
          <dl className="kv">
            <dt>{paid ? t.paid : t.amount}</dt>
            <dd><strong>${fromCents(order.captured_cents ?? order.amount_cents)}</strong> {order.currency}</dd>
            <dt>{t.paypalOrder}</dt><dd className="mono">{order.paypal_order_id ?? "—"}</dd>
            <dt>{t.paypalCapture}</dt><dd className="mono">{order.capture_id ?? "—"}</dd>
            {refunded && (<><dt>{t.refunded}</dt><dd style={{ color: "var(--ok)", fontWeight: 650 }}>${fromCents(refunded.amount_cents)}</dd></>)}
          </dl>
          <ol className="timeline" aria-label={t.progress}>
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
              <h2 style={{ fontSize: 22 }}>{t.finishedTitle}</h2>
              <p className="muted" style={{ margin: "8px 0 0", fontSize: 15 }}>{t.finishedBody}</p>
              <form action="/checkout/return" method="get" style={{ marginTop: 14 }}>
                <input type="hidden" name="order" value={order.id} />
                <SubmitButton pendingLabel={t.checking} className="btn btn-ghost">{t.checkPayment}</SubmitButton>
              </form>
            </section>
          )}

          {paid && !refunded && (
            <section className="card card-pad claim-card rise" style={{ ["--i" as string]: 2 }}>
              <span className="eyebrow">{t.claimEyebrow}</span>
              <h2 style={{ marginTop: 8 }}>{t.claimTitle}</h2>
              <ClaimForm orderId={order.id} t={tt.form} />
              <ol className="how">
                <li><span className="n">1</span>{t.how1}</li>
                <li><span className="n">2</span>{t.how2}</li>
                <li><span className="n">3</span>{t.how3}</li>
              </ol>
            </section>
          )}

          {claims.length > 0 && (
            <section className="card card-pad rise" style={{ ["--i" as string]: 3 }}>
              <h2 style={{ fontSize: 22 }}>{t.claims}</h2>
              <ul className="list">
                {claims.map((c) => {
                  const s = { label: t.statuses[c.status] ?? c.status, tone: STATUS_TONE[c.status] ?? ("wait" as const) };
                  return (
                    <li key={c.id}>
                      <a href={`/claims/${c.id}`}>
                        <span style={{ overflowWrap: "anywhere" }}>
                          {c.source === "image" ? `${t.screenshot}${c.competitor_domain ? ` · ${c.competitor_domain}` : ""}` : new URL(c.competitor_url).hostname.replace(/^www\./, "")}
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
