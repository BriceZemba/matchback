import { randomUUID } from "node:crypto";
import { getDb, now } from "@/lib/db";
import type { C3Offer } from "@/lib/channel3";
import type { Locale } from "@/lib/i18n";
import { getOrderRow, type OrderRow } from "@/lib/paypal/checkout";
import { InvariantError } from "@/lib/paypal/errors";
import { isResaleDomain } from "@/lib/verifier/policy";
import { defaultDeps, evaluateClaim, fileWatchClaim, verifyClaim, type ClaimEvidence, type ClaimRow, type VerifyDeps } from "@/lib/verifier/run";

// Price watch: after a purchase, Matchback keeps looking at the other stores that sell the same
// product (the offers on its Channel3 record). When one drops below what the shopper paid, the usual
// verifier runs on it, with the same rules as a shopper's claim. Only offers the verifier approves
// become findings. The merchant picks what happens next: suggest it to the shopper (default) or file
// and refund automatically.

export type WatchMode = "suggest" | "auto";
export type FindingRow = {
  id: string;
  order_id: string;
  domain: string;
  offer_url: string;
  price_cents: number;
  refund_cents: number;
  status: "suggested" | "claimed" | "expired";
  evidence_json: string;
  claim_id: string | null;
  found_at: string;
};

export function watchModeFromEnv(env: NodeJS.ProcessEnv = process.env): WatchMode {
  return env.MATCHBACK_WATCH_MODE === "auto" ? "auto" : "suggest";
}

/** The finding the shopper can act on now, if any. */
export function activeFinding(orderId: string): FindingRow | undefined {
  return getDb().prepare("SELECT * FROM watch_findings WHERE order_id = ? AND status = 'suggested' ORDER BY found_at DESC LIMIT 1").get(orderId) as FindingRow | undefined;
}

export function lastWatched(orderId: string): string | null {
  const row = getDb().prepare("SELECT watch_checked_at FROM orders WHERE id = ?").get(orderId) as { watch_checked_at: string | null } | undefined;
  return row?.watch_checked_at ?? null;
}

const cents = (o: C3Offer) => Math.round(o.price.price * 100);

/** Why an order is not watched right now, or null when it is. */
function notWatchable(order: OrderRow | undefined, deps: Pick<VerifyDeps, "settings" | "now">): string | null {
  if (!order || order.status !== "captured" || !order.capture_id) return "not paid";
  const db = getDb();
  if (db.prepare("SELECT 1 FROM refunds WHERE order_id = ? AND kind = 'price_match'").get(order.id)) return "already refunded";
  if (db.prepare("SELECT 1 FROM claims WHERE order_id = ? AND status IN ('verifying', 'approved', 'refund_unknown')").get(order.id)) return "claim in progress";
  const paidAt = Date.parse(order.captured_at ?? order.created_at);
  if (deps.now().getTime() - paidAt > deps.settings.windowDays * 86_400_000) return "claim window closed";
  return null;
}

export type WatchResult =
  | { order: string; outcome: "skipped"; reason: string }
  | { order: string; outcome: "none"; checked: number }
  | { order: string; outcome: "found"; finding: FindingRow; claim?: ClaimRow };

/** Look for a cheaper qualifying offer for one order and verify it. */
export async function watchOrder(orderId: string, deps: VerifyDeps = defaultDeps(), mode: WatchMode = watchModeFromEnv()): Promise<WatchResult> {
  const db = getDb();
  const order = getOrderRow(orderId);
  const skip = notWatchable(order, deps);
  if (skip) return { order: orderId, outcome: "skipped", reason: skip };
  const paidCents = order!.captured_cents ?? order!.amount_cents;
  const title = (db.prepare("SELECT title FROM catalog WHERE product_id = ?").get(order!.product_id) as { title: string }).title;

  const product = await deps.channel3.product(order!.product_id);
  db.prepare("UPDATE orders SET watch_checked_at = ? WHERE id = ?").run(now(), orderId);
  // Cheap pre-filter so the verifier only runs on offers that could qualify; the verifier re-checks all of it.
  const candidates = (product.offers ?? [])
    .filter((o) => !isResaleDomain(o.domain) && o.condition === "new" && o.availability === "InStock" && o.price.currency === order!.currency)
    .filter((o) => cents(o) <= paidCents - deps.settings.minDiffCents)
    .sort((a, b) => cents(a) - cents(b));

  for (const offer of candidates.slice(0, 2)) {
    const offerUrl = offer.url ?? `https://${offer.domain}/`;
    const evidence: ClaimEvidence = await evaluateClaim(
      {
        purchasedProductId: order!.product_id,
        purchasedTitle: title,
        paidCents,
        currency: order!.currency,
        capturedAt: order!.captured_at ?? order!.created_at,
        competitorUrl: offerUrl,
        resolved: { product, domain: offer.domain },
      },
      deps,
    );
    if (evidence.decision.status !== "approved") continue;

    const current = activeFinding(orderId);
    if (current && current.domain === offer.domain && current.price_cents === cents(offer)) return { order: orderId, outcome: "found", finding: current };
    if (current) db.prepare("UPDATE watch_findings SET status = 'expired' WHERE id = ?").run(current.id);
    const id = randomUUID();
    db.prepare("INSERT INTO watch_findings (id, order_id, domain, offer_url, price_cents, refund_cents, status, evidence_json, found_at) VALUES (?, ?, ?, ?, ?, ?, 'suggested', ?, ?)")
      .run(id, orderId, offer.domain, offerUrl, cents(offer), evidence.decision.refundCents, JSON.stringify(evidence), now());
    if (mode === "auto") {
      const claim = await verifyClaim(fileFromFinding(id, "en").id, deps);
      return { order: orderId, outcome: "found", finding: getFinding(id)!, claim };
    }
    return { order: orderId, outcome: "found", finding: getFinding(id)! };
  }
  // Nothing qualifies any more: an older suggestion is no longer true.
  db.prepare("UPDATE watch_findings SET status = 'expired' WHERE order_id = ? AND status = 'suggested'").run(orderId);
  return { order: orderId, outcome: "none", checked: candidates.length };
}

export function getFinding(id: string): FindingRow | undefined {
  return getDb().prepare("SELECT * FROM watch_findings WHERE id = ?").get(id) as FindingRow | undefined;
}

/** Turn a finding into a claim. verifyClaim then runs the verifier again on fresh data before any refund. */
export function fileFromFinding(findingId: string, locale: Locale): ClaimRow {
  const finding = getFinding(findingId);
  if (!finding || finding.status !== "suggested") throw new InvariantError(409, "This price drop is no longer available.");
  const claim = fileWatchClaim(finding.order_id, finding.offer_url, finding.domain, locale);
  getDb().prepare("UPDATE watch_findings SET status = 'claimed', claim_id = ? WHERE id = ?").run(claim.id, findingId);
  return claim;
}

/** Watch every paid order still inside the claim window, one at a time. */
export async function watchAll(deps: VerifyDeps = defaultDeps(), mode: WatchMode = watchModeFromEnv()): Promise<WatchResult[]> {
  const ids = (getDb().prepare("SELECT id FROM orders WHERE status = 'captured' ORDER BY created_at").all() as { id: string }[]).map((r) => r.id);
  const out: WatchResult[] = [];
  for (const id of ids) {
    try {
      out.push(await watchOrder(id, deps, mode));
    } catch (err) {
      out.push({ order: id, outcome: "skipped", reason: err instanceof Error ? err.message : "error" });
    }
  }
  return out;
}
