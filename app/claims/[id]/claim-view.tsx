"use client";

import { useEffect, useState } from "react";

type Check = { id: string; label: string; outcome: "pass" | "fail" | "review"; detail: string };
type ClaimJson = {
  id: string;
  orderId: string;
  competitorUrl: string;
  status: string;
  source?: "link" | "image";
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
const PENDING_STEPS = [
  { label: "Reading the competitor page", detail: "Channel3 looks up the offer: price, stock and condition." },
  { label: "Comparing the products", detail: "Same model, not a bundle, another edition or a refurbished unit." },
  { label: "Applying the price-match policy", detail: "Claim window, qualifying store, plausible price." },
];
const IMAGE_STEP = { label: "Reading your screenshot", detail: "AI reads the product, store and price from your image." };
const MATCHED_BY: Record<string, string> = {
  link_in_image: "the link visible in your image",
  purchased_product_offer: "your product's live listing at that store",
  text_search: "a Channel3 search for the product",
  image_search: "a Channel3 search by image",
};
const CONFETTI_COLORS = ["var(--accent)", "#f2c94c", "#6aa9ff", "var(--coral)", "var(--ink)"];

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

function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 26 }, (_, i) => {
        const angle = (i / 26) * Math.PI * 2;
        const dist = 120 + (i % 5) * 34;
        return (
          <i
            key={i}
            style={{
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              ["--dx" as string]: `${Math.cos(angle) * dist}px`,
              ["--dy" as string]: `${Math.sin(angle) * dist * 0.7 + 60}px`,
              ["--rot" as string]: `${(i % 2 ? 1 : -1) * (180 + i * 23)}deg`,
              ["--d" as string]: `${(i % 6) * 40}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

function Icon({ kind }: { kind: "ok" | "no" | "wait" | "scan" }) {
  if (kind === "scan") return <span className="spinner" style={{ width: 20, height: 20 }} />;
  const d = kind === "ok" ? "M5 12.5l4.5 4.5L19 7.5" : kind === "no" ? "M7 7l10 10M17 7L7 17" : "M12 7v6M12 17h.01";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClaimView({ id }: { id: string }) {
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

  if (missing) return <main className="shell"><div className="page-head"><h1>Claim not found</h1></div></main>;

  const status = claim?.status ?? "verifying";
  const ev = claim?.evidence;
  const checks = ev?.decision.checks ?? [];
  const firstProblem = checks.find((c) => c.outcome === "fail") ?? checks.find((c) => c.outcome === "review");
  const isImage = claim?.source === "image";
  const host = !claim ? "" : isImage ? (claim.competitorDomain ?? "") : new URL(claim.competitorUrl).hostname.replace(/^www\./, "");

  const view =
    !claim ? { kind: "scan" as const, eyebrow: "Loading", title: "Loading your claim…" }
    : status === "refunded" ? { kind: "ok" as const, eyebrow: "Price match approved", title: "The difference is on its way back to you" }
    : status === "refused" ? { kind: "no" as const, eyebrow: "Not approved", title: "This offer doesn't qualify for a price match" }
    : status === "needs_review" ? { kind: "wait" as const, eyebrow: "With a person", title: "We couldn't verify everything automatically" }
    : status === "refund_failed" ? { kind: "no" as const, eyebrow: "Approved", title: "The refund didn't go through" }
    : status === "refund_unknown" ? { kind: "wait" as const, eyebrow: "Approved", title: "Confirming your refund with PayPal" }
    : status === "approved" ? { kind: "scan" as const, eyebrow: "Approved", title: "Sending your refund through PayPal…" }
    : { kind: "scan" as const, eyebrow: "Checking", title: isImage ? "Reading your screenshot…" : `Checking the offer at ${host || "the other store"}…` };

  return (
    <main className="shell">
      <div className="page-head">
        {claim && <a className="back" href={`/orders/${claim.orderId}`}>← Your order</a>}
      </div>

      <section className={`verdict ${view.kind}`} aria-live="polite">
        {refunded && <Confetti />}
        <div className="verdict-icon"><Icon kind={view.kind} /></div>
        <p className="eyebrow" style={{ margin: "14px 0 0", color: view.kind === "no" ? "var(--coral)" : view.kind === "ok" ? "var(--accent)" : "var(--amber)" }}>{view.eyebrow}</p>
        <h1>{view.title}</h1>
        {refunded && ev && (
          <>
            <div className="amount">{usd(amount)}</div>
            <p className="muted" style={{ margin: "10px 0 0" }}>
              refunded to your PayPal account · PayPal refund <span className="mono">{claim?.refundId}</span>
            </p>
          </>
        )}
        {ev?.explanation && view.kind !== "scan" ? (
          <div className="explain">
            <span className="ai-chip">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" fill="currentColor" /></svg>
              {ev.explanation.source === "ai" ? "AI summary of the checks below" : "Summary of the checks below"}
            </span>
            <p>{ev.explanation.text}</p>
          </div>
        ) : (
          (status === "refused" || status === "needs_review") && firstProblem && <p className="muted" style={{ margin: "10px 0 0", fontSize: 16 }}>{firstProblem.detail}</p>
        )}
        {status === "needs_review" && <p className="subtle" style={{ margin: "8px 0 0" }}>The store will look at it and you&apos;ll hear back. Nothing has been charged or refunded yet.</p>}
        {claim?.error && <p className="muted" style={{ margin: "10px 0 0" }}>{claim.error}</p>}
        {view.kind === "scan" && <div className="scanbar" />}
        {!isImage && (
          <p className="subtle" style={{ margin: "14px 0 0", overflowWrap: "anywhere" }}>
            Link checked: <a href={claim?.competitorUrl} target="_blank" rel="noreferrer noopener">{claim?.competitorUrl}</a>
          </p>
        )}
      </section>

      <h2 className="section-title">What Matchback checked</h2>
      <ol className="checks">
        {checks.length > 0
          ? checks.map((c, i) => (
              <li key={c.id} className={`check ${c.outcome}`} style={{ ["--i" as string]: i }}>
                <span className="check-mark" aria-label={c.outcome}>{MARK[c.outcome]}</span>
                <span><div className="check-label">{c.label}</div><div className="check-detail">{c.detail}</div></span>
              </li>
            ))
          : status === "verifying" && claim && (isImage ? [IMAGE_STEP, ...PENDING_STEPS] : PENDING_STEPS).map((s, i) => (
              <li key={s.label} className="check pending" style={{ ["--i" as string]: i }}>
                <span className="check-mark"><span className="spinner" style={{ width: 14, height: 14 }} /></span>
                <span><div className="check-label">{s.label}</div><div className="check-detail">{s.detail}</div><div className="skeleton" /></span>
              </li>
            ))}
      </ol>

      {isImage && claim && (
        <>
          <h2 className="section-title">Your screenshot</h2>
          <div className="card card-pad shot rise">
            <img src={`/api/claims/${claim.id}/image`} alt="The screenshot you sent" />
            <div>
              <span className="ai-chip">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" fill="currentColor" /></svg>
                What the AI read{ev?.image?.provider ? ` (${ev.image.provider})` : ""}
              </span>
              {ev?.image?.extraction ? (
                <dl className="read-grid">
                  <dt>Product</dt><dd>{[ev.image.extraction.brand, ev.image.extraction.product, ev.image.extraction.model].filter(Boolean).join(" · ") || "—"}</dd>
                  <dt>Store</dt><dd>{ev.image.extraction.store ?? "—"}{ev.image.extraction.storeDomain ? ` (${ev.image.extraction.storeDomain})` : ""}</dd>
                  <dt>Price shown</dt><dd>{ev.image.extraction.priceCents !== null ? usd(ev.image.extraction.priceCents) : "—"}</dd>
                  {ev.image.extraction.conditionWords.length > 0 && (<><dt>Condition words</dt><dd>{ev.image.extraction.conditionWords.join(", ")}</dd></>)}
                  <dt>Confidence</dt><dd>{ev.image.extraction.confidence}</dd>
                  <dt>Live listing</dt><dd>{ev.image.matchedBy ? `Found via ${MATCHED_BY[ev.image.matchedBy] ?? ev.image.matchedBy}` : ev.image.reason ?? "—"}</dd>
                </dl>
              ) : (
                <p className="muted" style={{ margin: "10px 0 0" }}>{status === "verifying" ? "Reading…" : ev?.image?.reason ?? "The image could not be read."}</p>
              )}
            </div>
          </div>
        </>
      )}

      {ev?.competitor && (
        <>
          <h2 className="section-title">Evidence</h2>
          <div className="evidence">
            <div className="card rise" style={{ ["--i" as string]: 1 }}>
              <h3>Competitor listing</h3>
              <p>{ev.competitor.title}</p>
              <p className="subtle">
                {ev.competitor.domain} · {ev.decision.competitorCents !== null ? usd(ev.decision.competitorCents) : "no price"} · {ev.competitor.condition ?? "condition not stated"}
                {ev.competitor.availability ? ` · ${ev.competitor.availability === "InStock" ? "in stock" : "out of stock"}` : ""}
              </p>
            </div>
            {ev.identity && (
              <div className="card rise" style={{ ["--i" as string]: 2 }}>
                <h3>Same product?</h3>
                <p>{ev.identity.relation.replaceAll("_", " ")}</p>
                <p className="subtle">{ev.identity.method === "channel3_id" ? "Same Channel3 catalog product" : `AI comparison${ev.identity.provider ? ` (${ev.identity.provider})` : ""}`}</p>
              </div>
            )}
            {ev.priceContext && ev.priceContext.min_price > 0 && ev.priceContext.max_price / ev.priceContext.min_price <= 4 && (
              <div className="card rise" style={{ ["--i" as string]: 3 }}>
                <h3>90-day price history</h3>
                <p>Currently {ev.priceContext.current_status}</p>
                <p className="subtle">Range ${ev.priceContext.min_price.toFixed(2)} – ${ev.priceContext.max_price.toFixed(2)} (Channel3)</p>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
