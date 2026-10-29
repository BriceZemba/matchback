import { beforeEach, describe, expect, it } from "vitest";
import type { C3Offer, C3Product, Channel3Client } from "@/lib/channel3";
import { getDb, resetDbForTests } from "@/lib/db";
import type { LlmProvider } from "@/lib/llm";
import { createOrderRow } from "@/lib/paypal/checkout";
import { verifyClaim, type VerifyDeps } from "@/lib/verifier/run";
import { activeFinding, fileFromFinding, getFinding, watchAll, watchOrder } from "@/lib/watch";

const offer = (domain: string, price: number, over: Partial<C3Offer> = {}): C3Offer => ({ domain, price: { price, currency: "USD" }, availability: "InStock", condition: "new", url: `https://buy.example/${domain}`, ...over });
const mouse = (offers: C3Offer[]): C3Product => ({ id: "nLZKmNT", title: "Logitech MX Master 3S", offers });

const provider: LlmProvider = { name: "groq", baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };
const llmDown: typeof fetch = async () => { throw new TypeError("fetch failed"); };

function deps(product: { current: C3Product }, refunds: { amountCents: number }[] = [], now = "2026-10-29T12:00:00Z"): VerifyDeps {
  const channel3: Channel3Client = {
    async lookup() { throw new Error("watch never looks up a URL"); },
    async product(id) { if (id !== product.current.id) throw new Error("no product"); return product.current; },
    async priceStats() { return null; },
  };
  return {
    channel3,
    settings: { windowDays: 14, minDiffCents: 100, floorShare: 0.6, allowColorVariants: true },
    identityMode: "ai",
    providers: [provider],
    llmFetch: llmDown,
    refund: async (r) => { refunds.push(r); return { claimId: r.claimId, refundId: "RF1", status: "COMPLETED", amountCents: r.amountCents, currency: "USD" }; },
    now: () => new Date(now),
  };
}

beforeEach(() => {
  process.env.MATCHBACK_DB = "data/test-watch/x.db";
  resetDbForTests();
  getDb().prepare("INSERT INTO catalog (product_id, title, price_cents, currency) VALUES ('nLZKmNT', 'Logitech MX Master 3S', 11999, 'USD')").run();
});

function capturedOrder(capturedAt = "2026-10-29T00:00:00Z") {
  const o = createOrderRow("nLZKmNT");
  getDb().prepare("UPDATE orders SET paypal_order_id=?, capture_id=?, captured_cents=11999, captured_at=?, status='captured' WHERE id=?").run(`PO-${o.id}`, `CAP-${o.id}`, capturedAt, o.id);
  return o.id;
}

describe("price watch", () => {
  it("suggests the cheapest offer the verifier approves, skipping resale, used, out-of-stock and tiny drops", async () => {
    const product = { current: mouse([
      offer("backmarket.com", 79, { condition: null }),
      offer("6ave.com", 85, { condition: "refurbished" }),
      offer("target.com", 89, { availability: "OutOfStock" }),
      offer("abt.com", 119.5),
      offer("bestbuy.com", 99.99),
      offer("officedepot.com", 104.99),
    ]) };
    const id = capturedOrder();
    const out = await watchOrder(id, deps(product), "suggest");
    expect(out.outcome).toBe("found");
    const f = activeFinding(id)!;
    expect(f).toMatchObject({ domain: "bestbuy.com", price_cents: 9999, refund_cents: 2000, status: "suggested", claim_id: null });
    expect(JSON.parse(f.evidence_json).decision.status).toBe("approved");
    expect(getDb().prepare("SELECT COUNT(*) n FROM claims").get()).toEqual({ n: 0 });
  });

  it("re-verifies on today's offer when the shopper claims, then refunds through PayPal", async () => {
    const product = { current: mouse([offer("bestbuy.com", 99.99)]) };
    const id = capturedOrder();
    await watchOrder(id, deps(product), "suggest");
    const finding = activeFinding(id)!;
    product.current = mouse([offer("bestbuy.com", 104.99)]); // price moved back up a little before the claim
    const refunds: { amountCents: number }[] = [];
    const claim = fileFromFinding(finding.id, "fr");
    const done = await verifyClaim(claim.id, deps(product, refunds));
    expect(done).toMatchObject({ status: "refunded", source: "watch", competitor_domain: "bestbuy.com", locale: "fr" });
    expect(refunds[0]!.amountCents).toBe(1500);
    expect(getFinding(finding.id)).toMatchObject({ status: "claimed", claim_id: claim.id });
    expect(() => fileFromFinding(finding.id, "en")).toThrow(/no longer available/);
  });

  it("files and refunds on its own in auto mode", async () => {
    const refunds: { amountCents: number }[] = [];
    const id = capturedOrder();
    const out = await watchOrder(id, deps({ current: mouse([offer("bestbuy.com", 99.99)]) }, refunds), "auto");
    expect(out.outcome === "found" && out.claim?.status).toBe("refunded");
    expect(refunds).toHaveLength(1);
  });

  it("expires a suggestion once no offer qualifies", async () => {
    const product = { current: mouse([offer("bestbuy.com", 99.99)]) };
    const id = capturedOrder();
    await watchOrder(id, deps(product), "suggest");
    product.current = mouse([offer("bestbuy.com", 119.99)]);
    expect(await watchOrder(id, deps(product), "suggest")).toMatchObject({ outcome: "none" });
    expect(activeFinding(id)).toBeUndefined();
  });

  it("does not watch orders outside the window, already refunded, or unpaid", async () => {
    const product = { current: mouse([offer("bestbuy.com", 99.99)]) };
    const old = capturedOrder("2026-10-01T00:00:00Z");
    expect(await watchOrder(old, deps(product), "suggest")).toMatchObject({ outcome: "skipped", reason: "claim window closed" });
    const refunded = capturedOrder();
    getDb().prepare("INSERT INTO refunds (claim_id, order_id, capture_id, kind, amount_cents, currency, status, created_at) VALUES ('c', ?, ?, 'price_match', 500, 'USD', 'completed', 'x')").run(refunded, `CAP-${refunded}`);
    expect(await watchOrder(refunded, deps(product), "suggest")).toMatchObject({ outcome: "skipped", reason: "already refunded" });
    createOrderRow("nLZKmNT");
    const all = await watchAll(deps(product), "suggest");
    expect(all.map((r) => r.outcome)).toEqual(["skipped", "skipped"]);
  });
});
