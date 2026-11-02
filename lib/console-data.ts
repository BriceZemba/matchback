import { listCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { claimRecords, type ClaimRecord } from "@/lib/merchant";
import { isResaleDomain } from "@/lib/verifier/policy";
import { brandStore, isKnownRetailer } from "@/lib/verifier/retailers";
import type { ClaimEvidence } from "@/lib/verifier/run";

// The merchant console's tables, read from the database on the server and handed to AG Studio in
// memory. Money is in dollars. Every row type is flat, with ids for the relations between tables.

const OUTCOME: Record<string, string> = {
  refunded: "Refunded", refused: "Refused", needs_review: "With a person", verifying: "Being checked",
  approved: "Refunding", refund_unknown: "Confirming refund", refund_failed: "Refund failed",
};
const SOURCE: Record<string, string> = { link: "Pasted link", image: "Screenshot", watch: "Price watch" };
const REASON: Record<string, string> = {
  all_passed: "All checks passed", review_approved: "Approved by a reviewer", review_refused: "Refused by a reviewer", verifying: "Being checked",
};

export type ConsoleClaim = {
  id: string; createdAt: string; day: string; status: string; outcome: string; source: string; decidedBy: string;
  orderId: string; productId: string; product: string; store: string; paid: number; offerPrice: number | null; gap: number | null;
  refunded: number; reason: string; aiRelation: string; decisionSeconds: number | null; reviewNote: string;
  isRefunded: number; isRefused: number; isReview: number; isDecided: number; isAutomatic: number;
  /** "yes" when the order already had its one price-match refund: this claim can only be refused. */
  orderRefunded: string;
};
export type ConsoleCheck = { id: string; claimId: string; check: string; outcome: string; detail: string; isFail: number; isReview: number };
export type ConsoleOrder = {
  id: string; productId: string; status: string; paidAt: string | null; paid: number; refunded: number;
  claimedSale: number; keptSale: number; fullReturn: number; claims: number;
};
export type ConsoleProduct = { id: string; product: string; brand: string; price: number };
export type ConsoleStore = { id: string; storeType: string };
export type ConsoleRefund = { claimId: string; orderId: string; amount: number; refundId: string; status: string; day: string };
export type ConsoleFinding = { id: string; orderId: string; store: string; price: number; refund: number; status: string; day: string };

export type ConsoleData = {
  asOf: string;
  claims: ConsoleClaim[];
  checks: ConsoleCheck[];
  orders: ConsoleOrder[];
  products: ConsoleProduct[];
  stores: ConsoleStore[];
  refunds: ConsoleRefund[];
  findings: ConsoleFinding[];
};

const cents = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Math.round(Number(v)) / 100);
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

function claimRow(r: ClaimRecord): ConsoleClaim {
  const decided = r.decidedBy !== "pending";
  return {
    id: r.id,
    createdAt: r.createdAt,
    day: day(r.createdAt),
    status: r.status,
    outcome: OUTCOME[r.status] ?? r.status,
    source: SOURCE[r.source] ?? r.source,
    decidedBy: r.decidedBy === "automatic" ? "Matchback" : r.decidedBy === "reviewer" ? "Reviewer" : "Pending",
    orderId: r.orderId,
    productId: r.productId,
    product: r.product,
    store: r.store ?? "unknown",
    paid: r.paid,
    offerPrice: r.offerPrice,
    gap: r.offerPrice === null ? null : Math.round((r.paid - r.offerPrice) * 100) / 100,
    refunded: r.refunded,
    reason: REASON[r.reasonId] ?? r.reason,
    aiRelation: r.aiRelation ? r.aiRelation.replaceAll("_", " ") : "",
    decisionSeconds: r.decisionSeconds,
    reviewNote: r.reviewNote ?? "",
    isRefunded: r.status === "refunded" ? 1 : 0,
    isRefused: r.status === "refused" ? 1 : 0,
    isReview: r.status === "needs_review" ? 1 : 0,
    isDecided: decided ? 1 : 0,
    isAutomatic: r.decidedBy === "automatic" ? 1 : 0,
    orderRefunded: "no",
  };
}

export async function loadConsoleData(): Promise<ConsoleData> {
  const db = getDb();
  const records = await claimRecords({ limit: 1000 });
  const claims = records.map(claimRow);

  const decisions = (await db.all("SELECT id, decision_json FROM claims WHERE decision_json IS NOT NULL ORDER BY created_at DESC LIMIT 1000")) as { id: string; decision_json: string }[];
  const checks: ConsoleCheck[] = decisions.flatMap(({ id, decision_json }) => {
    const ev = JSON.parse(decision_json) as ClaimEvidence;
    return ev.decision.checks.map((c) => ({
      id: `${id}:${c.id}`, claimId: id, check: c.label, outcome: c.outcome === "pass" ? "Passed" : c.outcome === "fail" ? "Failed" : "Needs a person",
      detail: c.detail, isFail: c.outcome === "fail" ? 1 : 0, isReview: c.outcome === "review" ? 1 : 0,
    }));
  });

  const orderRows = (await db.all(
    `SELECT o.id, o.product_id, o.status, o.captured_at, o.captured_cents, o.amount_cents,
            (SELECT SUM(r.amount_cents) FROM refunds r WHERE r.order_id = o.id AND r.status = 'completed') AS refunded,
            (SELECT COUNT(*) FROM claims c WHERE c.order_id = o.id) AS claims
     FROM orders o WHERE o.status = 'captured' ORDER BY o.created_at DESC LIMIT 1000`,
  )) as { id: string; product_id: string; status: string; captured_at: string | null; captured_cents: number | string | null; amount_cents: number | string; refunded: number | string | null; claims: number | string }[];
  const orders: ConsoleOrder[] = orderRows.map((o) => {
    const paid = cents(o.captured_cents ?? o.amount_cents);
    const refunded = cents(o.refunded);
    const claimed = refunded > 0;
    return {
      id: o.id, productId: o.product_id, status: "Paid", paidAt: day(o.captured_at) || null, paid, refunded,
      claimedSale: claimed ? paid : 0,
      keptSale: claimed ? Math.round((paid - refunded) * 100) / 100 : 0,
      fullReturn: claimed ? paid : 0,
      claims: Number(o.claims),
    };
  });

  const refundedOrders = new Set(((await db.all("SELECT order_id FROM refunds WHERE kind = 'price_match'")) as { order_id: string }[]).map((r) => r.order_id));
  for (const claim of claims) if (refundedOrders.has(claim.orderId)) claim.orderRefunded = "yes";

  const catalog = await listCatalog();
  const products: ConsoleProduct[] = catalog.map((p) => ({ id: p.product_id, product: p.title, brand: p.title.split(/\s+/)[0] ?? "", price: p.price_cents / 100 }));

  const storeIds = [...new Set(claims.map((c) => c.store))];
  const stores: ConsoleStore[] = storeIds.map((id) => ({
    id,
    storeType: id === "unknown" ? "Unknown"
      : isResaleDomain(id) ? "Resale marketplace"
      : isKnownRetailer(id) ? "Listed competitor"
      : catalog.some((p) => brandStore(id, p.title)) ? "Brand store"
      : "Not on the list",
  }));

  const refunds = ((await db.all("SELECT claim_id, order_id, amount_cents, refund_id, status, created_at FROM refunds WHERE kind = 'price_match' AND status = 'completed' ORDER BY created_at DESC LIMIT 1000")) as {
    claim_id: string; order_id: string; amount_cents: number | string; refund_id: string | null; status: string; created_at: string;
  }[]).map((r) => ({ claimId: r.claim_id, orderId: r.order_id, amount: cents(r.amount_cents), refundId: r.refund_id ?? "", status: r.status, day: day(r.created_at) }));

  const findings = ((await db.all("SELECT id, order_id, domain, price_cents, refund_cents, status, found_at FROM watch_findings ORDER BY found_at DESC LIMIT 1000")) as {
    id: string; order_id: string; domain: string; price_cents: number | string; refund_cents: number | string; status: string; found_at: string;
  }[]).map((f) => ({ id: f.id, orderId: f.order_id, store: f.domain, price: cents(f.price_cents), refund: cents(f.refund_cents), status: f.status, day: day(f.found_at) }));

  return { asOf: new Date().toISOString(), claims, checks, orders, products, stores, refunds, findings };
}
