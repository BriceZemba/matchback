import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { cookieValue } from "@/lib/i18n";
import { offerCentsOf, type ClaimEvidence, type ClaimStatus } from "@/lib/verifier/run";

// The store's side: the review queue, every decision, and the numbers the merchant console reads.
// One secret, MERCHANT_KEY: typed once on /merchant (kept as a session cookie derived from it), or
// sent as "Authorization: Bearer <key>" by the console's data sources. Unset = the merchant side is off.

export const MERCHANT_COOKIE = "mb_merchant";

export function merchantKey(): string | null {
  const key = process.env.MERCHANT_KEY?.trim();
  return key && key.length >= 8 ? key : null;
}

/** The cookie value for a signed-in merchant: derived from the key, so changing the key signs everyone out. */
export function merchantSession(key: string): string {
  return createHmac("sha256", key).update("matchback-merchant-session").digest("hex");
}

function same(a: string | undefined | null, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function isMerchantSession(cookie: string | undefined): boolean {
  const key = merchantKey();
  return !!key && same(cookie, merchantSession(key));
}

export function isMerchantRequest(req: Request): boolean {
  const key = merchantKey();
  if (!key) return false;
  return same(req.headers.get("authorization"), `Bearer ${key}`) || same(cookieValue(req, MERCHANT_COOKIE), merchantSession(key));
}

export function keyMatches(typed: string): boolean {
  const key = merchantKey();
  return !!key && same(typed.trim(), key);
}

/** One claim as a flat row: what a grid shows and what the console's agent reads. Money in dollars. */
export type ClaimRecord = {
  id: string;
  createdAt: string;
  decidedAt: string | null;
  decisionSeconds: number | null;
  status: ClaimStatus;
  source: "link" | "image" | "watch";
  decidedBy: "automatic" | "reviewer" | "pending";
  orderId: string;
  productId: string;
  product: string;
  paid: number;
  store: string | null;
  offerPrice: number | null;
  refunded: number;
  refundId: string | null;
  /** A check id (window, identity…) or all_passed, review_approved, review_refused, verifying. */
  reasonId: string;
  reason: string;
  aiRelation: string | null;
  aiProvider: string | null;
  reviewNote: string | null;
  competitorUrl: string;
  locale: string;
};

type Row = {
  id: string; order_id: string; competitor_url: string; status: ClaimStatus; decision_json: string | null; refund_id: string | null;
  created_at: string; decided_at: string | null; source: "link" | "image" | "watch"; competitor_domain: string | null; locale: string;
  product_id: string; captured_cents: number | string | null; amount_cents: number | string; title: string | null; refund_cents: number | string | null;
};

const dollars = (cents: number | string | null | undefined) => (cents === null || cents === undefined ? 0 : Math.round(Number(cents)) / 100);

export function toRecord(r: Row): ClaimRecord {
  const ev = r.decision_json ? (JSON.parse(r.decision_json) as ClaimEvidence) : null;
  const checks = ev?.decision.checks ?? [];
  const problem = checks.find((c) => c.outcome === "fail") ?? checks.find((c) => c.outcome === "review");
  const reason =
    ev?.review ? (ev.review.outcome === "approved" ? "Approved by a reviewer" : "Refused by a reviewer")
    : problem ? problem.label
    : r.status === "verifying" ? "Being checked"
    : ev ? "All checks passed" : "";
  const reasonId =
    ev?.review ? `review_${ev.review.outcome}` : problem ? problem.id : r.status === "verifying" ? "verifying" : ev ? "all_passed" : "";
  const offerCents = offerCentsOf(ev);
  const decided = r.decided_at ? (new Date(r.decided_at).getTime() - new Date(r.created_at).getTime()) / 1000 : null;
  return {
    id: r.id,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    decisionSeconds: decided === null || ev?.review ? null : Math.round(decided * 10) / 10,
    status: r.status,
    source: r.source,
    decidedBy: r.status === "verifying" || r.status === "needs_review" ? "pending" : ev?.review ? "reviewer" : "automatic",
    orderId: r.order_id,
    productId: r.product_id,
    product: r.title ?? r.product_id,
    paid: dollars(r.captured_cents ?? r.amount_cents),
    store: ev?.competitor?.domain ?? r.competitor_domain ?? (r.source === "link" ? hostOf(r.competitor_url) : null),
    offerPrice: offerCents === null ? null : dollars(offerCents),
    refunded: dollars(r.refund_cents),
    refundId: r.refund_id,
    reasonId,
    reason,
    aiRelation: ev?.identity?.relation ?? null,
    aiProvider: ev?.identity?.provider ?? null,
    reviewNote: ev?.review?.note || null,
    competitorUrl: r.competitor_url,
    locale: r.locale,
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const SELECT = `
  SELECT c.id, c.order_id, c.competitor_url, c.status, c.decision_json, c.refund_id, c.created_at, c.decided_at, c.source,
         c.competitor_domain, c.locale, o.product_id, o.captured_cents, o.amount_cents, p.title,
         (SELECT r.amount_cents FROM refunds r WHERE r.claim_id = c.id AND r.status = 'completed') AS refund_cents
  FROM claims c JOIN orders o ON o.id = c.order_id LEFT JOIN catalog p ON p.product_id = o.product_id`;

/** Every claim, newest first. */
export async function claimRecords(opts: { status?: ClaimStatus; limit?: number } = {}): Promise<ClaimRecord[]> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000);
  const rows = (opts.status
    ? await getDb().all(`${SELECT} WHERE c.status = ? ORDER BY c.created_at DESC LIMIT ${limit}`, opts.status)
    : await getDb().all(`${SELECT} ORDER BY c.created_at DESC LIMIT ${limit}`)) as Row[];
  return rows.map(toRecord);
}

export type Summary = {
  claims: number;
  byStatus: Record<string, number>;
  waitingForReview: number;
  decidedAutomatically: number;
  automaticShare: number | null;
  refundedTotal: number;
  /** Sales kept: what was paid on refunded orders minus the refunds, instead of a full return. */
  salesKept: number;
  refusedClaims: number;
  medianDecisionSeconds: number | null;
  stores: { store: string; claims: number; refunded: number; refused: number }[];
  products: { product: string; claims: number; refunded: number }[];
};

export function summarize(records: ClaimRecord[]): Summary {
  const byStatus: Record<string, number> = {};
  for (const r of records) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const decided = records.filter((r) => r.decidedBy !== "pending");
  const automatic = decided.filter((r) => r.decidedBy === "automatic");
  const refundedRecords = records.filter((r) => r.refunded > 0);
  const times = automatic.map((r) => r.decisionSeconds).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const group = <K extends string>(key: (r: ClaimRecord) => K | null) => {
    const m = new Map<K, ClaimRecord[]>();
    for (const r of records) {
      const k = key(r);
      if (k) m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };
  const cents = (n: number) => Math.round(n * 100);
  return {
    claims: records.length,
    byStatus,
    waitingForReview: byStatus.needs_review ?? 0,
    decidedAutomatically: automatic.length,
    automaticShare: decided.length ? Math.round((automatic.length / decided.length) * 1000) / 10 : null,
    refundedTotal: refundedRecords.reduce((s, r) => s + cents(r.refunded), 0) / 100,
    salesKept: refundedRecords.reduce((s, r) => s + cents(r.paid) - cents(r.refunded), 0) / 100,
    refusedClaims: byStatus.refused ?? 0,
    medianDecisionSeconds: times.length ? times[Math.floor(times.length / 2)]! : null,
    stores: group((r) => r.store).slice(0, 10).map(([store, rs]) => ({
      store, claims: rs.length, refunded: rs.reduce((s, r) => s + cents(r.refunded), 0) / 100, refused: rs.filter((r) => r.status === "refused").length,
    })),
    products: group((r) => r.product).slice(0, 12).map(([product, rs]) => ({
      product, claims: rs.length, refunded: rs.reduce((s, r) => s + cents(r.refunded), 0) / 100,
    })),
  };
}
