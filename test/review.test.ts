import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "@/lib/db";
import { claimRecords, isMerchantRequest, isMerchantSession, keyMatches, merchantSession, summarize } from "@/lib/merchant";
import { createOrderRow } from "@/lib/paypal/checkout";
import { approveReviewedClaim, getClaim, refuseReviewedClaim, suggestedRefundCents, type ClaimEvidence } from "@/lib/verifier/run";

const evidence = (over: Partial<ClaimEvidence["decision"]> = {}): ClaimEvidence => ({
  decision: {
    status: "needs_review",
    refundCents: 0,
    competitorCents: 9999,
    checks: [
      { id: "window", label: "Within the claim window", outcome: "pass", detail: "Paid today." },
      { id: "condition", label: "Sold new", outcome: "review", detail: "The offer does not state its condition." },
    ],
    ...over,
  },
  identity: { relation: "same_product", method: "llm", evidence: [], provider: "groq" },
  competitor: { productId: "x", title: "Logitech MX Master 3S", domain: "bestbuy.com", condition: null, conditionSource: "none" },
  purchased: { productId: "nLZKmNT", title: "Logitech MX Master 3S" },
  priceContext: null,
  explanation: { text: "A person will check this claim.", source: "ai", provider: "groq" },
});

async function claimForReview(status = "needs_review", locale = "en") {
  const o = await createOrderRow("nLZKmNT");
  await getDb().run("UPDATE orders SET paypal_order_id=?, capture_id=?, captured_cents=11999, captured_at=?, status='captured' WHERE id=?", `PO-${o.id}`, `CAP-${o.id}`, "2026-10-29T00:00:00Z", o.id);
  const id = `c-${o.id}`;
  await getDb().run(
    "INSERT INTO claims (id, order_id, competitor_url, status, decision_json, created_at, decided_at, locale) VALUES (?, ?, 'https://www.bestbuy.com/p/1', ?, ?, '2026-10-29T10:00:00Z', '2026-10-29T10:00:08Z', ?)",
    id, o.id, status, JSON.stringify(evidence()), locale,
  );
  return id;
}

const okRefund = (calls: { amountCents: number; claimId: string }[]) => async (r: { claimId: string; amountCents: number }) => {
  calls.push(r);
  return { claimId: r.claimId, refundId: "RF-REVIEW", status: "COMPLETED", amountCents: r.amountCents, currency: "USD" };
};

beforeEach(async () => {
  resetDbForTests();
  await getDb().run("INSERT INTO catalog (product_id, title, price_cents, currency) VALUES ('nLZKmNT', 'Logitech MX Master 3S', 11999, 'USD')");
});

describe("review queue", () => {
  it("a reviewer approves: the refund goes through and the shopper's note says a person approved it", async () => {
    const id = await claimForReview("needs_review", "fr");
    const calls: { amountCents: number; claimId: string }[] = [];
    const claim = await approveReviewedClaim(id, 2000, "Condition checked on the store's page", okRefund(calls));
    expect(calls).toEqual([expect.objectContaining({ claimId: id, amountCents: 2000 })]);
    expect(claim).toMatchObject({ status: "refunded", refund_id: "RF-REVIEW" });
    const ev = JSON.parse(claim.decision_json!) as ClaimEvidence;
    expect(ev.review).toMatchObject({ outcome: "approved", amountCents: 2000, note: "Condition checked on the store's page" });
    expect(ev.decision.refundCents).toBe(2000);
    expect(ev.explanation).toMatchObject({ source: "template" });
    expect(ev.explanation!.text).toContain("20.00");
    expect(ev.explanation!.text).toMatch(/personne du magasin/);
  });

  it("decides each claim once: a second approval is refused and does not reach PayPal", async () => {
    const id = await claimForReview();
    const calls: { amountCents: number; claimId: string }[] = [];
    await approveReviewedClaim(id, 2000, "", okRefund(calls));
    await expect(approveReviewedClaim(id, 2000, "", okRefund(calls))).rejects.toMatchObject({ status: 409 });
    await expect(refuseReviewedClaim(id, "")).rejects.toMatchObject({ status: 409 });
    expect(calls).toHaveLength(1);
  });

  it("only claims waiting for review can be decided", async () => {
    const id = await claimForReview("refused");
    await expect(approveReviewedClaim(id, 2000, "", okRefund([]))).rejects.toMatchObject({ status: 409 });
  });

  it("an amount over the store's cap is rejected and the claim stays in the queue", async () => {
    const id = await claimForReview();
    await expect(approveReviewedClaim(id, 9000, "", okRefund([]))).rejects.toMatchObject({ status: 400 });
    await expect(approveReviewedClaim(id, 0, "", okRefund([]))).rejects.toMatchObject({ status: 400 });
    expect((await getClaim(id))!.status).toBe("needs_review");
  });

  it("an order that already had its refund cannot be approved again; the claim stays to be refused", async () => {
    const id = await claimForReview();
    const claim = (await getClaim(id))!;
    await getDb().run("INSERT INTO refunds (claim_id, order_id, capture_id, kind, amount_cents, currency, status, created_at) VALUES ('earlier', ?, 'CAP', 'price_match', 500, 'USD', 'completed', 'x')", claim.order_id);
    await expect(approveReviewedClaim(id, 2000, "", okRefund([]))).rejects.toMatchObject({ status: 409 });
    expect((await getClaim(id))!.status).toBe("needs_review");
  });

  it("a refund PayPal refuses leaves the claim approved-but-failed, with a note saying so", async () => {
    const id = await claimForReview();
    const { InvariantError } = await import("@/lib/paypal/errors");
    const claim = await approveReviewedClaim(id, 2000, "", async () => { throw new InvariantError(409, "This order already received a price-match refund."); });
    expect(claim).toMatchObject({ status: "refund_failed", error: "This order already received a price-match refund." });
    expect(JSON.parse(claim.decision_json!).explanation.text).toContain("could not be completed");
  });

  it("a reviewer refuses: no refund, and the receipt carries the store's note", async () => {
    const id = await claimForReview();
    const claim = await refuseReviewedClaim(id, "The offer is a marketplace seller.");
    expect(claim.status).toBe("refused");
    const ev = JSON.parse(claim.decision_json!) as ClaimEvidence;
    expect(ev.review).toMatchObject({ outcome: "refused", amountCents: null });
    expect(ev.decision.refundCents).toBe(0);
    expect(ev.explanation!.text).toBe("A person at the store checked your claim and could not approve it. Note from the store: The offer is a marketplace seller.");
  });

  it("suggests the gap to the live offer, or to the price read from a screenshot", () => {
    expect(suggestedRefundCents(evidence(), 11999)).toBe(2000);
    const fromImage = { ...evidence({ competitorCents: null }), image: { extraction: { priceCents: 10999 } as never, provider: "groq", matchedBy: null } };
    expect(suggestedRefundCents(fromImage, 11999)).toBe(1000);
    expect(suggestedRefundCents(evidence({ competitorCents: 12999 }), 11999)).toBeNull();
    expect(suggestedRefundCents(null, 11999)).toBeNull();
    // A screenshot whose search found another product: the image's price, not that listing's.
    const wrongListing = {
      ...evidence({ competitorCents: 57499, checks: [{ id: "listing", label: "Store's live listing found", outcome: "review" as const, detail: "Closest listing is another product." }] }),
      image: { extraction: { priceCents: 22999 } as never, provider: "groq", matchedBy: "text_search" },
    };
    expect(suggestedRefundCents(wrongListing, 27499)).toBe(4500);
  });
});

describe("merchant data", () => {
  it("lists claims as flat rows and totals them", async () => {
    const waiting = await claimForReview();
    const done = await claimForReview();
    await approveReviewedClaim(done, 2000, "", okRefund([]));
    await getDb().run("UPDATE refunds SET status = 'completed'"); // the stub refund wrote no refunds row
    await getDb().run("INSERT INTO refunds (claim_id, order_id, capture_id, kind, amount_cents, currency, refund_id, status, created_at) SELECT id, order_id, 'CAP-x', 'price_match', 2000, 'USD', 'RF-REVIEW', 'completed', created_at FROM claims WHERE id = ?", done);

    const rows = await claimRecords();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === waiting)).toMatchObject({ status: "needs_review", decidedBy: "pending", reasonId: "condition", reason: "Sold new", store: "bestbuy.com", paid: 119.99, offerPrice: 99.99, refunded: 0 });
    expect(rows.find((r) => r.id === done)).toMatchObject({ status: "refunded", decidedBy: "reviewer", reasonId: "review_approved", refunded: 20 });
    expect(await claimRecords({ status: "needs_review" })).toHaveLength(1);

    const s = summarize(rows);
    expect(s).toMatchObject({ claims: 2, waitingForReview: 1, refundedTotal: 20, salesKept: 99.99, decidedAutomatically: 0, automaticShare: 0 });
    expect(s.stores[0]).toMatchObject({ store: "bestbuy.com", claims: 2, refunded: 20 });
  });
});

describe("merchant access", () => {
  afterEach(() => { delete process.env.MERCHANT_KEY; });

  it("is off without a key, and accepts the session cookie or the key as a Bearer token", () => {
    const req = (headers: Record<string, string>) => new Request("https://m.test/api/merchant/claims", { headers });
    expect(isMerchantRequest(req({ authorization: "Bearer anything" }))).toBe(false);
    process.env.MERCHANT_KEY = "short";
    expect(isMerchantRequest(req({ authorization: "Bearer short" }))).toBe(false); // too short to count as a key

    process.env.MERCHANT_KEY = "a-long-merchant-key";
    expect(keyMatches(" a-long-merchant-key ")).toBe(true);
    expect(keyMatches("a-long-merchant-kez")).toBe(false);
    expect(isMerchantRequest(req({ authorization: "Bearer a-long-merchant-key" }))).toBe(true);
    expect(isMerchantRequest(req({ authorization: "Bearer wrong" }))).toBe(false);
    const session = merchantSession("a-long-merchant-key");
    expect(session).not.toContain("a-long-merchant-key");
    expect(isMerchantRequest(req({ cookie: `mb_merchant=${session}` }))).toBe(true);
    expect(isMerchantSession(session)).toBe(true);
    process.env.MERCHANT_KEY = "a-different-merchant-key";
    expect(isMerchantSession(session)).toBe(false); // a new key signs everyone out
  });
});
