import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { claimRecords, isMerchantSession, merchantKey, MERCHANT_COOKIE, summarize, type ClaimRecord } from "@/lib/merchant";
import { judgeMode } from "@/lib/judge";
import { requestPrefs } from "@/lib/locale-server";
import { maxRefundShare } from "@/lib/paypal/refunds";
import { checkDetail } from "@/lib/verifier/check-text";
import { getClaim, orderRefunded, suggestedRefundCents, type ClaimEvidence } from "@/lib/verifier/run";
import { SubmitButton } from "../submit-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Matchback · store desk" };

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The store's side: claims sent to a person (approve with a refund, or refuse), every decision, the totals.
export default async function MerchantPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!merchantKey()) notFound();
  const q = await searchParams;
  const { t, locale } = await requestPrefs();
  const m = t.merchant;
  const signedIn = isMerchantSession((await cookies()).get(MERCHANT_COOKIE)?.value);

  if (!signedIn) {
    return (
      <main className="shell">
        <div className="page-head">
          <p className="eyebrow">{m.eyebrow}</p>
          <h1 className="rise">{m.title}</h1>
          <p className="muted">{m.signInLede}</p>
          {judgeMode() && <p className="subtle" style={{ margin: 0 }}>{m.judgeKeyHint}</p>}
        </div>
        <form className="card card-pad merchant-login" method="post" action="/api/merchant/login">
          <div className="field">
            <label htmlFor="key">{m.keyLabel}</label>
            <input id="key" name="key" type="password" autoComplete="current-password" required className="input" />
          </div>
          {q.error === "key" && <p className="notice notice-warn" role="alert">{m.wrongKey}</p>}
          <div style={{ marginTop: 16 }}>
            <SubmitButton pendingLabel={m.signingIn}>{m.signIn}</SubmitButton>
          </div>
        </form>
      </main>
    );
  }

  const records = await claimRecords({ limit: 500 });
  const summary = summarize(records);
  const share = await maxRefundShare();
  const queue = await Promise.all(
    records.filter((r) => r.status === "needs_review").map(async (r) => {
      const row = await getClaim(r.id);
      const evidence = row?.decision_json ? (JSON.parse(row.decision_json) as ClaimEvidence) : null;
      const paidCents = Math.round(r.paid * 100);
      const gap = suggestedRefundCents(evidence, paidCents);
      return { r, evidence, suggested: gap === null ? null : Math.min(gap, Math.floor(paidCents * share)), refunded: await orderRefunded(r.orderId) };
    }),
  );
  const pct = Math.round(share * 100);
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  const tone = (s: string) => (s === "refunded" ? "ok" : s === "refused" || s === "refund_failed" ? "no" : "wait");

  return (
    <main className="shell merchant">
      <div className="page-head merchant-head">
        <div>
          <p className="eyebrow">{m.eyebrow}</p>
          <h1 className="rise">{m.title}</h1>
          <p className="muted" style={{ maxWidth: 640 }}>{m.lede}</p>
        </div>
        <div className="merchant-head-actions">
          <a className="btn btn-accent" href="/merchant/console">{m.console}</a>
          <a className="btn btn-ghost" href="/merchant/settings">{m.settings.link}</a>
          <form method="post" action="/api/merchant/logout">
            <button className="btn btn-ghost" type="submit">{m.signOut}</button>
          </form>
        </div>
      </div>

      {q.done && q.status && <p className="notice" role="status">{m.done[q.status] ?? q.status}</p>}
      {q.error && q.error !== "key" && <p className="notice notice-warn" role="alert">{q.error}</p>}

      <section className="stat-row" aria-label={m.title}>
        <Stat label={m.stats.claims} value={String(summary.claims)} />
        <Stat label={m.stats.waiting} value={String(summary.waitingForReview)} accent={summary.waitingForReview > 0} />
        <Stat label={m.stats.automatic} value={summary.automaticShare === null ? "—" : `${summary.automaticShare}%`} />
        <Stat label={m.stats.median} value={summary.medianDecisionSeconds === null ? "—" : m.seconds(summary.medianDecisionSeconds)} />
        <Stat label={m.stats.refunded} value={money(summary.refundedTotal)} />
        <Stat label={m.stats.kept} value={money(summary.salesKept)} hint={m.keptHint} />
      </section>
      <p className="subtle" style={{ margin: "10px 0 0" }}>{m.stats.kept}: {m.keptHint}</p>

      <section>
        <div className="section-head"><h2>{m.queue}</h2></div>
        {queue.length === 0 ? (
          <p className="card card-pad muted">{m.queueEmpty}</p>
        ) : (
          <div className="review-list">
            {queue.map(({ r, evidence, suggested, refunded }, i) => (
              <article key={r.id} id={`claim-${r.id}`} className="card card-pad review-card rise" style={{ ["--i" as string]: i }}>
                <div className="review-top">
                  <div>
                    <p className="eyebrow">{when(r.createdAt)} · {m.sources[r.source] ?? r.source}</p>
                    <h3>{r.product}</h3>
                  </div>
                  <a className="back" href={`/claims/${r.id}`} target="_blank" rel="noreferrer">{m.receipt} ↗</a>
                </div>
                <div className="review-body">
                  <dl className="kv">
                    <dt>{m.paid}</dt><dd>{money(r.paid)}</dd>
                    <dt>{m.offer}</dt>
                    <dd>
                      {r.offerPrice === null ? m.noOffer : money(r.offerPrice)}
                      {r.store ? <> · <a href={r.competitorUrl} target="_blank" rel="noreferrer noopener">{r.store}</a></> : null}
                    </dd>
                  </dl>
                  {r.source === "image" && (
                    <a href={`/api/claims/${r.id}/image`} target="_blank" rel="noreferrer" className="review-shot">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/claims/${r.id}/image`} alt={m.screenshot} loading="lazy" />
                    </a>
                  )}
                </div>
                <div className="review-why">
                  <p className="eyebrow">{m.why}</p>
                  <ul>
                    {(evidence?.decision.checks ?? []).filter((c) => c.outcome !== "pass").map((c) => (
                      <li key={c.id} className={c.outcome}>
                        <strong>{t.claim.checkLabels[c.id] ?? c.label}</strong> {checkDetail(c.detail, locale)}
                      </li>
                    ))}
                  </ul>
                </div>
                {evidence?.explanation && (
                  <div className="explain">
                    <span className="ai-chip">{m.aiNote}</span>
                    <p>{evidence.explanation.text}</p>
                  </div>
                )}
                <form className="review-form" method="post" action={`/api/merchant/claims/${r.id}/${refunded ? "refuse" : "approve"}`}>
                  {refunded ? <p className="subtle review-full" style={{ margin: "12px 0 0" }}>{m.alreadyRefunded}</p> : <div className="field">
                    <label htmlFor={`amount-${r.id}`}>{m.amount}</label>
                    <input id={`amount-${r.id}`} name="amount" className="input mono" inputMode="decimal" required pattern="\$?\d+(\.\d{1,2})?"
                      defaultValue={suggested === null ? "" : (suggested / 100).toFixed(2)} />
                  </div>}
                  <div className="field">
                    <label htmlFor={`note-${r.id}`}>{m.note}</label>
                    <input id={`note-${r.id}`} name="note" className="input" maxLength={300} />
                  </div>
                  {!refunded && <p className="subtle" style={{ margin: "10px 0 0" }}>{m.capHint(pct)}</p>}
                  <div className="review-actions">
                    {!refunded && <SubmitButton pendingLabel={m.approving} className="btn btn-accent">{m.approve}</SubmitButton>}
                    <SubmitButton pendingLabel={m.refusing} className="btn btn-ghost" formAction={`/api/merchant/claims/${r.id}/refuse`} noValidate>{m.refuse}</SubmitButton>
                  </div>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>

      {summary.stores.length > 0 && (
        <section>
          <div className="section-head"><h2>{m.stores}</h2></div>
          <ul className="store-bars card card-pad">
            {summary.stores.slice(0, 6).map((s) => (
              <li key={s.store}>
                <span className="mono">{s.store}</span>
                <span className="bar" style={{ ["--w" as string]: `${Math.round((s.claims / summary.stores[0]!.claims) * 100)}%` }} aria-hidden="true" />
                <span className="subtle">{m.storeLine(s.claims, s.refused)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="section-head"><h2>{m.decisions}</h2></div>
        {records.length === 0 ? (
          <p className="card card-pad muted">{m.noClaims}</p>
        ) : (
          <div className="table-wrap card">
            <table className="decisions">
              <thead>
                <tr>
                  <th>{m.cols.when}</th><th>{m.cols.product}</th><th>{m.cols.store}</th><th className="num">{m.cols.offer}</th>
                  <th>{m.cols.outcome}</th><th>{m.cols.reason}</th><th className="num">{m.cols.refunded}</th><th>{m.cols.by}</th>
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 100).map((r: ClaimRecord) => (
                  <tr key={r.id}>
                    <td className="mono"><a href={`/claims/${r.id}`} target="_blank" rel="noreferrer">{when(r.createdAt)}</a></td>
                    <td>{r.product}</td>
                    <td className="mono">{r.store ?? "—"}</td>
                    <td className="num mono">{r.offerPrice === null ? "—" : money(r.offerPrice)}</td>
                    <td><span className={`status status-${tone(r.status)}`}>{m.status[r.status] ?? r.status}</span></td>
                    <td>{m.reasons[r.reasonId] ?? t.claim.checkLabels[r.reasonId] ?? r.reason}</td>
                    <td className="num mono">{r.refunded ? money(r.refunded) : "—"}</td>
                    <td>{m.by[r.decidedBy]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </main>
  );
}

function Stat({ label, value, hint, accent = false }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={`stat card${accent ? " stat-accent" : ""}`} title={hint}>
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
