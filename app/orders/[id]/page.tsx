import { notFound } from "next/navigation";
import { getCatalogItem } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { fromCents } from "@/lib/money";
import { approveUrlOf, getOrderRow } from "@/lib/paypal/checkout";
import { claimsForOrder } from "@/lib/verifier/run";
import { loadStoreSettings } from "@/lib/store-settings";
import { activeFinding, lastWatched } from "@/lib/watch";
import { judgeMode, SAMPLE_LINKS } from "@/lib/judge";
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

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; payment?: string }> }) {
  const { id } = await params;
  const { notice, payment } = await searchParams;
  const { locale, t: tt } = await requestPrefs();
  const t = tt.order;
  const order = await getOrderRow(id);
  if (!order) notFound();
  const product = await getCatalogItem(order.product_id);
  const refunds = await getDb().all("SELECT claim_id, refund_id, amount_cents, status FROM refunds WHERE order_id = ?", id) as {
    claim_id: string; refund_id: string | null; amount_cents: number; status: string;
  }[];
  const claims = await claimsForOrder(id);
  const paid = order.status === "captured";
  const expired = !paid && payment === "expired";
  const paymentNote = expired ? t.paymentExpired : !paid && payment === "pending" ? t.paymentPending : undefined;
  const approveUrl = order.status === "awaiting_approval" && !expired ? await approveUrlOf(id) : undefined;
  const refunded = refunds.find((r) => r.status === "completed");

  const steps = [
    { label: t.s1, sub: t.s1sub, done: true },
    { label: t.s2, sub: paid ? t.s2subDone(`$${fromCents(order.captured_cents!)}`) : t.s2subWait, done: paid },
    { label: t.s3, sub: claims.length ? t.s3subDone(claims.length) : t.s3subWait, done: claims.some((c) => c.status !== "verifying") },
    { label: t.s4, sub: refunded ? t.s4subDone(`$${fromCents(refunded.amount_cents)}`) : t.s4subWait, done: Boolean(refunded) },
  ];
  const current = steps.findIndex((s) => !s.done);
  const w = tt.watch;
  const finding = paid && !refunded ? await activeFinding(id) : undefined;
  const watchedAt = await lastWatched(id);
  const ago = (iso: string) => {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    return mins < 60 ? rtf.format(-mins, "minute") : mins < 2880 ? rtf.format(-Math.round(mins / 60), "hour") : rtf.format(-Math.round(mins / 1440), "day");
  };

  return (
    <main className="shell">
      <div className="page-head">
        <a className="back" href="/">{t.back}</a>
        <h1 className="rise">{t.title}</h1>
      </div>
      {(paymentNote ?? notice) && <p className="notice notice-warn" role="status" style={{ marginTop: 0, marginBottom: 18 }}>{paymentNote ?? notice}</p>}

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
              <div className="pay-actions">
                {approveUrl && <a className="btn btn-primary" href={approveUrl}>{t.continuePaypal}</a>}
                {expired ? (
                  <a className="btn btn-primary" href="/">{tt.myOrders.shop}</a>
                ) : (
                  <form action="/checkout/return" method="get">
                    <input type="hidden" name="order" value={order.id} />
                    <input type="hidden" name="check" value="1" />
                    <SubmitButton pendingLabel={t.checking} className="btn btn-ghost">{t.checkPayment}</SubmitButton>
                  </form>
                )}
              </div>
            </section>
          )}

          {paid && !refunded && (
            <section className={`card card-pad watch-card rise${finding ? " found" : ""}`} style={{ ["--i" as string]: 2 }} aria-live="polite">
              <div className="watch-head">
                <span className="eyebrow">{w.eyebrow}</span>
                <span className="watch-live"><span className="pulse" />{w.watching}</span>
              </div>
              {finding ? (
                <>
                  <h2>{w.foundTitle}</h2>
                  <p className="muted" style={{ margin: "8px 0 0", fontSize: 15 }}>{w.foundBody(finding.domain, `$${fromCents(finding.price_cents)}`)}</p>
                  <dl className="kv watch-kv">
                    <dt>{w.youPaid}</dt><dd>${fromCents(order.captured_cents ?? order.amount_cents)}</dd>
                    <dt>{finding.domain}</dt><dd>${fromCents(finding.price_cents)}</dd>
                    <dt>{w.youGet}</dt><dd className="watch-back">${fromCents(finding.refund_cents)}</dd>
                  </dl>
                  <ul className="watch-checks">{w.verified.map((v) => <li key={v}><Check />{v}</li>)}</ul>
                  <form action="/api/watch/claim" method="post" style={{ marginTop: 16 }}>
                    <input type="hidden" name="findingId" value={finding.id} />
                    <input type="hidden" name="orderId" value={order.id} />
                    <SubmitButton pendingLabel={w.claiming} className="btn btn-accent">{w.claim(`$${fromCents(finding.refund_cents)}`)}</SubmitButton>
                  </form>
                  <p className="subtle" style={{ margin: "10px 0 0" }}>{w.recheck}</p>
                </>
              ) : (
                <>
                  <h2>{w.idleTitle}</h2>
                  <p className="muted" style={{ margin: "8px 0 0", fontSize: 15 }}>{w.idleBody((await loadStoreSettings()).windowDays)}</p>
                </>
              )}
              <form action="/api/watch/check" method="post" className="watch-foot">
                <input type="hidden" name="orderId" value={order.id} />
                <span className="subtle mono">{w.lastChecked}: {watchedAt ? ago(watchedAt) : w.never}</span>
                <SubmitButton pendingLabel={w.checking} className="btn btn-ghost btn-sm">{w.checkNow}</SubmitButton>
              </form>
            </section>
          )}

          {paid && !refunded && (
            <section className="card card-pad claim-card rise" style={{ ["--i" as string]: 3 }}>
              <span className="eyebrow">{t.claimEyebrow}</span>
              <h2 style={{ marginTop: 8 }}>{t.claimTitle}</h2>
              <ClaimForm orderId={order.id} t={tt.form} samples={judgeMode() ? SAMPLE_LINKS[order.product_id] ?? [] : []} />
              <ol className="how">
                <li><span className="n">1</span>{t.how1}</li>
                <li><span className="n">2</span>{t.how2}</li>
                <li><span className="n">3</span>{t.how3}</li>
              </ol>
            </section>
          )}

          {claims.length > 0 && (
            <section className="card card-pad rise" style={{ ["--i" as string]: 4 }}>
              <h2 style={{ fontSize: 22 }}>{t.claims}</h2>
              <ul className="list">
                {claims.map((c) => {
                  const s = { label: t.statuses[c.status] ?? c.status, tone: STATUS_TONE[c.status] ?? ("wait" as const) };
                  return (
                    <li key={c.id}>
                      <a href={`/claims/${c.id}`}>
                        <span style={{ overflowWrap: "anywhere" }}>
                          {c.source === "image" ? `${t.screenshot}${c.competitor_domain ? ` · ${c.competitor_domain}` : ""}` : c.source === "watch" ? `${w.claimLabel} · ${c.competitor_domain}` : new URL(c.competitor_url).hostname.replace(/^www\./, "")}
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
