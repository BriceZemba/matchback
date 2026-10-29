"use client";

import { useEffect, useState } from "react";
import type { ClaimDict, Locale } from "@/lib/i18n";

type Check = { id: string; label: string; outcome: "pass" | "fail" | "review"; detail: string };
type ClaimJson = {
  id: string;
  orderId: string;
  competitorUrl: string;
  status: string;
  source?: "link" | "image" | "watch";
  competitorDomain?: string | null;
  refundId: string | null;
  error: string | null;
  evidence: null | {
    decision: { status: string; refundCents: number; competitorCents: number | null; checks: Check[] };
    competitor: { title: string; domain: string; condition: string | null; conditionSource?: string; availability?: string } | null;
    purchased: { title: string };
    identity: { relation: string; method: string; provider?: string } | null;
    priceContext: { current_status: string; min_price: number; max_price: number } | null;
    explanation?: { text: string; source: "ai" | "template"; provider?: string };
    image?: {
      extraction: { product: string; brand: string | null; model: string | null; store: string | null; storeDomain: string | null; priceCents: number | null; conditionWords: string[]; confidence: string } | null;
      provider: string | null;
      matchedBy: string | null;
      reason?: string;
    };
  };
};

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const MARK = { pass: "✓", fail: "✕", review: "?" } as const;

function useCountUp(target: number, run: boolean) {
  const [value, setValue] = useState(run ? 0 : target);
  useEffect(() => {
    if (!run) return setValue(target);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setValue(target);
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - start) / 1100, 1);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return value;
}

export function ClaimView({ id, locale, t }: { id: string; locale: Locale; t: ClaimDict }) {
  const [claim, setClaim] = useState<ClaimJson | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await fetch(`/api/claims/${id}`, { cache: "no-store" });
        if (res.status === 404) return setMissing(true);
        const data = (await res.json()) as ClaimJson;
        if (stop) return;
        setClaim(data);
        if (data.status === "verifying" || data.status === "approved") timer = setTimeout(load, 1500);
      } catch {
        if (!stop) timer = setTimeout(load, 3000);
      }
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  const refunded = claim?.status === "refunded";
  const amount = useCountUp(claim?.evidence?.decision.refundCents ?? 0, refunded);

  if (missing) return <main className="shell"><div className="page-head"><h1>{t.notFound}</h1></div></main>;

  const status = claim?.status ?? "verifying";
  const ev = claim?.evidence;
  const checks = ev?.decision.checks ?? [];
  const firstProblem = checks.find((c) => c.outcome === "fail") ?? checks.find((c) => c.outcome === "review");
  const isImage = claim?.source === "image";
  const paidCents = (() => {
    const detail = checks.find((c) => c.id === "cheaper")?.detail;
    const m = detail?.match(/vs \$([\d,]+\.\d{2}) paid/);
    return m ? Math.round(Number(m[1]!.replace(/,/g, "")) * 100) : null;
  })();
  const host = !claim ? "" : isImage || claim.source === "watch" ? (claim.competitorDomain ?? "") : new URL(claim.competitorUrl).hostname.replace(/^www\./, "");

  const view =
    !claim ? { kind: "scan" as const, eyebrow: t.loadingEyebrow, title: t.loadingTitle }
    : status === "refunded" ? { kind: "ok" as const, eyebrow: t.okEyebrow, title: t.okTitle }
    : status === "refused" ? { kind: "no" as const, eyebrow: t.noEyebrow, title: t.noTitle }
    : status === "needs_review" ? { kind: "wait" as const, eyebrow: t.waitEyebrow, title: t.waitTitle }
    : status === "refund_failed" ? { kind: "no" as const, eyebrow: t.failedEyebrow, title: t.failedTitle }
    : status === "refund_unknown" ? { kind: "wait" as const, eyebrow: t.unknownEyebrow, title: t.unknownTitle }
    : status === "approved" ? { kind: "scan" as const, eyebrow: t.sendingEyebrow, title: t.sendingTitle }
    : { kind: "scan" as const, eyebrow: t.checkingEyebrow, title: isImage ? t.readingTitle : t.checkingTitle.replace("{host}", host || t.otherStore) };

  return (
    <main className="shell">
      <div className="page-head">
        {claim && <a className="back" href={`/orders/${claim.orderId}`}>{t.backToOrder}</a>}
      </div>

      <section className={`verdict ${view.kind}`} aria-live="polite">
        <div className="receipt-head">
          <strong>Matchback</strong>
          {t.receipt}{claim ? ` · ${t.no} ${claim.id.slice(0, 8).toUpperCase()}` : ""}
        </div>
        {view.kind !== "scan" && (
          <span className={`stamp ${view.kind}`} aria-hidden="true">{view.kind === "ok" ? t.stampOk : view.kind === "no" ? t.stampNo : t.stampWait}</span>
        )}
        <p className="eyebrow" style={{ color: view.kind === "no" ? "var(--stamp)" : view.kind === "ok" ? "var(--ok)" : "var(--wait)" }}>{view.eyebrow}</p>
        <h1>{view.title}</h1>
        {ev && paidCents !== null && ev.decision.competitorCents !== null && view.kind !== "scan" && (
          <dl className="kv" style={{ borderTop: "1.5px dashed var(--hair)", paddingTop: 14 }}>
            <dt>{t.paid}</dt><dd>{usd(paidCents)}</dd>
            <dt>{host || t.elsewhere}</dt><dd>{usd(ev.decision.competitorCents)}</dd>
          </dl>
        )}
        {refunded && ev && (
          <>
            <div className="amount">{usd(amount)}</div>
            <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
              {t.backToPaypal} <span className="mono">{claim?.refundId}</span>
            </p>
          </>
        )}
        {ev?.explanation && view.kind !== "scan" ? (
          <div className="explain">
            <span className="ai-chip">{ev.explanation.source === "ai" ? t.aiNote : t.note}</span>
            <p>{ev.explanation.text}</p>
          </div>
        ) : (
          (status === "refused" || status === "needs_review") && firstProblem && <p className="muted" style={{ margin: "10px 0 0", fontSize: 16 }}>{firstProblem.detail}</p>
        )}
        {status === "needs_review" && <p className="subtle" style={{ margin: "8px 0 0" }}>{t.reviewHint}</p>}
        {claim?.error && <p className="muted" style={{ margin: "10px 0 0" }}>{claim.error}</p>}
        {view.kind === "scan" && <div className="scanbar" />}
        {!isImage && (
          <p className="subtle" style={{ margin: "14px 0 0", overflowWrap: "anywhere" }}>
            {t.linkChecked} <a href={claim?.competitorUrl} target="_blank" rel="noreferrer noopener">{claim?.competitorUrl}</a>
          </p>
        )}
      </section>

      <h2 className="section-title">{t.checked}</h2>
      {locale !== "en" && checks.length > 0 && <p className="subtle" style={{ margin: "-6px 0 12px" }}>{t.detailsNote}</p>}
      <ol className="checks">
        {checks.length > 0
          ? checks.map((c, i) => (
              <li key={c.id} className={`check ${c.outcome}`} style={{ ["--i" as string]: i }}>
                <span className="check-mark" aria-label={c.outcome}>{MARK[c.outcome]}</span>
                <span><div className="check-label">{t.checkLabels[c.id] ?? c.label}</div><div className="check-detail">{c.detail}</div></span>
              </li>
            ))
          : status === "verifying" && claim && (isImage ? [t.imageStep, ...t.pending] : t.pending).map((s, i) => (
              <li key={s.label} className="check pending" style={{ ["--i" as string]: i }}>
                <span className="check-mark"><span className="spinner" style={{ width: 14, height: 14 }} /></span>
                <span><div className="check-label">{s.label}</div><div className="check-detail">{s.detail}</div><div className="skeleton" /></span>
              </li>
            ))}
      </ol>

      {isImage && claim && (
        <>
          <h2 className="section-title">{t.yourScreenshot}</h2>
          <div className="card card-pad shot rise">
            <img src={`/api/claims/${claim.id}/image`} alt={t.screenshotAlt} />
            <div>
              <span className="ai-chip">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" fill="currentColor" /></svg>
                {t.whatAiRead}{ev?.image?.provider ? ` (${ev.image.provider})` : ""}
              </span>
              {ev?.image?.extraction ? (
                <dl className="read-grid">
                  <dt>{t.product}</dt><dd>{[ev.image.extraction.brand, ev.image.extraction.product, ev.image.extraction.model].filter(Boolean).join(" · ") || "—"}</dd>
                  <dt>{t.store}</dt><dd>{ev.image.extraction.store ?? "—"}{ev.image.extraction.storeDomain ? ` (${ev.image.extraction.storeDomain})` : ""}</dd>
                  <dt>{t.priceShown}</dt><dd>{ev.image.extraction.priceCents !== null ? usd(ev.image.extraction.priceCents) : "—"}</dd>
                  {ev.image.extraction.conditionWords.length > 0 && (<><dt>{t.conditionWords}</dt><dd>{ev.image.extraction.conditionWords.join(", ")}</dd></>)}
                  <dt>{t.confidence}</dt><dd>{t.confidenceLevels[ev.image.extraction.confidence] ?? ev.image.extraction.confidence}</dd>
                  <dt>{t.liveListing}</dt><dd>{ev.image.matchedBy ? `${t.foundVia} ${t.matchedBy[ev.image.matchedBy] ?? ev.image.matchedBy}` : ev.image.reason ?? "—"}</dd>
                </dl>
              ) : (
                <p className="muted" style={{ margin: "10px 0 0" }}>{status === "verifying" ? t.reading : ev?.image?.reason ?? t.unreadable}</p>
              )}
            </div>
          </div>
        </>
      )}

      {ev?.competitor && (
        <>
          <h2 className="section-title">{t.evidence}</h2>
          <div className="evidence">
            <div className="card rise" style={{ ["--i" as string]: 1 }}>
              <h3>{t.competitorListing}</h3>
              <p>{ev.competitor.title}</p>
              <p className="subtle">
                {ev.competitor.domain} · {ev.decision.competitorCents !== null ? usd(ev.decision.competitorCents) : t.noPrice} · {ev.competitor.condition ?? t.conditionNotStated}
                {ev.competitor.availability ? ` · ${ev.competitor.availability === "InStock" ? t.inStock : t.outOfStock}` : ""}
              </p>
            </div>
            {ev.identity && (
              <div className="card rise" style={{ ["--i" as string]: 2 }}>
                <h3>{t.sameProduct}</h3>
                <p>{t.relations[ev.identity.relation] ?? ev.identity.relation.replaceAll("_", " ")}</p>
                <p className="subtle">{ev.identity.method === "channel3_id" ? t.sameCatalog : `${t.aiComparison}${ev.identity.provider ? ` (${ev.identity.provider})` : ""}`}</p>
              </div>
            )}
            {ev.priceContext && ev.priceContext.min_price > 0 && ev.priceContext.max_price / ev.priceContext.min_price <= 4 && (
              <div className="card rise" style={{ ["--i" as string]: 3 }}>
                <h3>{t.priceHistory}</h3>
                <p>{t.currently} {t.historyStatus[ev.priceContext.current_status] ?? ev.priceContext.current_status}</p>
                <p className="subtle">{t.range} ${ev.priceContext.min_price.toFixed(2)} – ${ev.priceContext.max_price.toFixed(2)} (Channel3)</p>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
