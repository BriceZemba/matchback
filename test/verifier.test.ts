import { beforeEach, describe, expect, it } from "vitest";
import type { C3Offer, C3Product, Channel3Client } from "@/lib/channel3";
import { Channel3Error } from "@/lib/channel3";
import { getDb, resetDbForTests } from "@/lib/db";
import type { LlmProvider } from "@/lib/llm";
import { createOrderRow } from "@/lib/paypal/checkout";
import { decide, type PolicyInput, type PolicySettings } from "@/lib/verifier/policy";
import { approveReviewedClaim, evaluateClaim, fileClaim, verifyClaim, type VerifyDeps } from "@/lib/verifier/run";
import { InvariantError, OutcomeUnknownError } from "@/lib/paypal/errors";
import { autoRefundedOn, reserveAutoRefund } from "@/lib/store-settings";
import { editionConflict, generationUnconfirmed, type IdentityVerdict } from "@/lib/verifier/identity";

// Offers below are the ones Channel3 returned in the 2026-10-28 spike (spikes/channel3/out/*-rest.json).
const settings: PolicySettings = { windowDays: 14, minDiffCents: 100, floorShare: 0.6, allowColorVariants: true };
const NOW = new Date("2026-10-29T12:00:00Z");
const offer = (domain: string, price: number, condition: string | null, availability = "InStock"): C3Offer => ({
  domain,
  price: { price, currency: "USD" },
  availability,
  condition,
  url: `https://buy.example/${domain}`,
});
const same: IdentityVerdict = { relation: "same_product", method: "channel3_id", evidence: [] };
const base = (over: Partial<PolicyInput>): PolicyInput => ({
  paidCents: 11999,
  currency: "USD",
  capturedAt: "2026-10-29T00:10:00Z",
  now: NOW,
  competitorDomain: "officedepot.com",
  offer: offer("officedepot.com", 99.99, "new"),
  identity: same,
  settings,
  ...over,
});
const outcome = (d: ReturnType<typeof decide>, id: string) => d.checks.find((c) => c.id === id)?.outcome;

describe("policy", () => {
  it("approves a new, in-stock, lower offer for the same product and refunds the difference", () => {
    const d = decide(base({}));
    expect(d.status).toBe("approved");
    expect(d.refundCents).toBe(2000);
  });

  it("refuses the Back Market refurbished listing even though Channel3 maps it to the new product", () => {
    // Spike: backmarket.com MX Master 3S, $123, condition null, same canonical id nLZKmNT.
    const d = decide(base({ paidCents: 14999, competitorDomain: "backmarket.com", offer: offer("backmarket.com", 123, null) }));
    expect(d.status).toBe("refused");
    expect(outcome(d, "retailer")).toBe("fail");
    expect(outcome(d, "condition")).toBe("review");
  });

  it("sends an offer with no stated condition to a person instead of paying it", () => {
    // Spike: walmart.com Instant Pot lookup returned condition null.
    const d = decide(base({ competitorDomain: "walmart.com", offer: offer("walmart.com", 99.0, null) }));
    expect(d.status).toBe("needs_review");
  });

  it("refuses an out-of-stock offer", () => {
    // Spike: home.woot.com Instant Pot $64.99 OutOfStock vs $148.78 in stock elsewhere.
    const d = decide(base({ paidCents: 14878, competitorDomain: "home.woot.com", offer: offer("home.woot.com", 64.99, "new", "OutOfStock") }));
    expect(outcome(d, "stock")).toBe("fail");
    expect(d.status).toBe("refused");
  });

  it("refuses a different model and accepts a colour variant", () => {
    const shield: IdentityVerdict = { relation: "different_model", method: "llm", evidence: ["T7 Shield vs T7"], provider: "groq" };
    expect(decide(base({ identity: shield })).status).toBe("refused");
    const color: IdentityVerdict = { relation: "same_product_other_color", method: "llm", evidence: ["Empire Red vs Black Matte"], provider: "groq" };
    expect(decide(base({ identity: color })).status).toBe("approved");
    expect(decide(base({ identity: color, settings: { ...settings, allowColorVariants: false } })).status).toBe("refused");
  });

  it("sends an implausibly low price to a person", () => {
    const d = decide(base({ offer: offer("officedepot.com", 50, "new") }));
    expect(outcome(d, "floor")).toBe("review");
    expect(d.status).toBe("needs_review");
  });

  it("refuses a claim outside the window, and a price that is not lower", () => {
    expect(decide(base({ capturedAt: "2026-10-01T00:00:00Z" })).status).toBe("refused");
    expect(decide(base({ offer: offer("officedepot.com", 119.5, "new") })).status).toBe("refused"); // 49 cents < $1 minimum
  });

  it("sends a claim to a person when identity could not be established", () => {
    expect(decide(base({ identity: null })).status).toBe("needs_review");
  });
});

describe("generationUnconfirmed", () => {
  const p = (title: string, key_features?: string[]) => ({ id: title, title, ...(key_features ? { key_features } : {}) });

  it("doubts a match when only one listing names a later generation (eval held-out case qc-07)", () => {
    expect(generationUnconfirmed(p("Bose QuietComfort Ultra Earbuds (2nd Gen), Black"), p("Bose QuietComfort Ultra Wireless Earbuds Noise Cancelling Bluetooth Headphones, Black"))).toContain("generation 2");
    expect(generationUnconfirmed(p("Apple AirPods Pro"), p("Apple AirPods Pro 2nd Generation"))).toContain("generation 2");
  });

  it("reads the purchased generation from the store's own title when Channel3's record leaves it out", () => {
    const record = p("QuietComfort Ultra Earbuds");
    expect(generationUnconfirmed(record, p("Bose QuietComfort Ultra Wireless Noise Cancelling Earbuds 882826-0010 - Walmart.com"), "Bose QuietComfort Ultra Earbuds (2nd Gen), Black")).toContain("generation 2");
    expect(generationUnconfirmed(record, p("Bose QuietComfort Ultra Earbuds (2nd Gen)"), "Bose QuietComfort Ultra Earbuds (2nd Gen), Black")).toBeNull();
  });

  it("accepts a first generation, matching generations, or none at all", () => {
    expect(generationUnconfirmed(p("Echo Dot (1st Gen)"), p("Echo Dot"))).toBeNull();
    expect(generationUnconfirmed(p("AirPods Pro 2nd generation"), p("Apple AirPods Pro (2nd Gen)"))).toBeNull();
    expect(generationUnconfirmed(p("Logitech MX Master 3S"), p("Logitech MX Master 3S Graphite"))).toBeNull();
  });

  it("does not read marketing words as a generation (Kindle: \"Next-generation 7\" display\")", () => {
    expect(generationUnconfirmed(p("Amazon Kindle Paperwhite Next-generation 7 inch display"), p("Amazon Kindle Paperwhite (2024) - Jade"))).toBeNull();
  });

  it("ignores interface versions (the T7's USB 3.2 Gen 2)", () => {
    expect(generationUnconfirmed(p("Samsung T7 Portable SSD 1TB USB 3.2 Gen 2 External Solid State Drive"), p("Samsung, Portable SSD, 1TB, Up to 1,050MB/s, Titan Gray - Walmart.com"))).toBeNull();
  });
});

describe("editionConflict", () => {
  it("flags an edition word present in only one title", () => {
    expect(editionConflict("Logitech MX Master 3S Performance Wireless Mouse", "Logitech MX Master 3S for Business Wireless Laser Mouse,")).toContain("for business");
    expect(editionConflict("Amazon Kindle Paperwhite", "Amazon Kindle Paperwhite Kids (16 GB) 2024 Starfish")).toContain("kids");
    expect(editionConflict("Instant Pot DUO60 6 Qt 7-in-1", "Instant Pot 6Qt Duo Plus 9-in-1 Multicooker")).toContain("plus");
  });

  it("flags different generations only when both titles state one", () => {
    expect(editionConflict("Bose QuietComfort Ultra Earbuds (2nd Gen)", "Bose QuietComfort Ultra Earbuds (1st Gen)")).toContain("Generation");
    expect(editionConflict("Bose QuietComfort Ultra Earbuds (2nd Gen)", "Bose QuietComfort Ultra Earbuds")).toBeNull();
  });

  it("does not flag retailer titles that merely drop words (eval dev cases kin-02, ip-01, t7-06, qc-01)", () => {
    expect(editionConflict("Amazon Kindle Paperwhite", "Amazon Kindle Paperwhite (2024) - Jade")).toBeNull();
    expect(editionConflict("Instant Pot DUO60 6 Qt 7-in-1 Multi-Use Programmable Pressure Cooker", "Instant Pot, 6 Qt Electric Pressure Cooker 7-in-1, Easy Steam Release, Slow Cooker, Rice Cooker - Walmart.com")).toBeNull();
    expect(editionConflict("Samsung T7 Portable SSD 1TB USB 3.2 Gen 2 External Solid State Drive", "Samsung, Portable SSD, 1TB, Up to 1,050MB/s, Titan Gray - Walmart.com")).toBeNull();
    expect(editionConflict("QuietComfort Ultra Earbuds", "Bose Quietcomfort Earbuds")).toBeNull();
  });

  it("flags different model years when both titles state one", () => {
    expect(editionConflict("Amazon Kindle Paperwhite (2024)", "Amazon Kindle Paperwhite (2021) 8 GB")).toContain("Model year");
    expect(editionConflict("Amazon Kindle Paperwhite (2024)", "Amazon Kindle Paperwhite 2024 Jade")).toBeNull();
  });

  it("does not read interface versions as product generations", () => {
    expect(editionConflict("Samsung T7 Portable SSD 1TB USB 3.2 Gen 2", "Samsung T7 Portable SSD 1TB USB 3.2 Gen 1")).toBeNull();
    expect(editionConflict("Samsung T7 Portable SSD 1TB USB 3.2 Gen 2", "Samsung T7 Shield 1TB")).toContain("shield");
  });

  it("flags the Staples for-Business listing (eval dev case mx-08)", () => {
    expect(editionConflict("Logitech MX Master 3S Performance Wireless Mouse", "Logitech MX Master 3S for Business Wireless Laser Mouse,")).toContain("for business");
  });

  it("leaves colour variants and same products alone", () => {
    expect(editionConflict("Artisan Series Tilt-head Stand Mixer", "KitchenAid Artisan Series 5-Quart Tilt-Head Stand Mixer")).toBeNull();
    expect(editionConflict("Samsung T7 Portable SSD 1TB", "Samsung T7 1TB External USB 3.2 Gen 2 Portable SSD with Hardware Encryption Titan Gray")).toBeNull();
  });
});

// ---- verifier with fake Channel3 and fake LLM ----

const T7: C3Product = { id: "e2dXeQi", title: "Samsung T7 Portable SSD 1TB", brands: [{ name: "Samsung" }], offers: [offer("bhphotovideo.com", 230.01, "new")] };
const T7_SHIELD: C3Product = { id: "J4Kgrsx", title: "T7 Shield Portable SSD", brands: [{ name: "Samsung" }], offers: [offer("bhphotovideo.com", 271.3, "new")] };
const MX: C3Product = { id: "nLZKmNT", title: "Logitech MX Master 3S Performance Wireless Mouse", offers: [offer("officedepot.com", 99.99, "new"), offer("backmarket.com", 123, null)] };

function fakeChannel3(byUrl: Record<string, C3Product | Error>, byId: Record<string, C3Product>): Channel3Client {
  return {
    async lookup(url) {
      const p = byUrl[url];
      if (!p) throw new Channel3Error(404, "Product not found");
      if (p instanceof Error) throw p;
      return p;
    },
    async product(id) {
      return byId[id]!;
    },
    async priceStats() {
      return { mean: 1, min_price: 1, max_price: 2, current_price: 1, current_status: "typical" };
    },
  };
}

const provider: LlmProvider = { name: "groq", baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };
function llmReturning(relation: string) {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    calls.push(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "report_identity", arguments: JSON.stringify({ relation, evidence: ["model differs"] }) } }] } }] }), { status: 200 });
  };
  return { fetch, calls };
}
const llmDown: typeof globalThis.fetch = async () => { throw new TypeError("fetch failed"); };

const deps = (channel3: Channel3Client, llmFetch: typeof fetch, over: Partial<VerifyDeps> = {}): VerifyDeps => ({
  channel3,
  settings,
  identityMode: "ai",
  providers: [provider],
  llmFetch,
  refund: async () => { throw new Error("refund not expected"); },
  now: () => NOW,
  ...over,
});
const input = (url: string, productId = "e2dXeQi", paidCents = 27499) => ({
  purchasedProductId: productId,
  purchasedTitle: "x",
  paidCents,
  currency: "USD",
  capturedAt: "2026-10-29T00:10:00Z",
  competitorUrl: url,
});

describe("evaluateClaim", () => {
  const shieldUrl = "https://www.bhphotovideo.com/c/product/1691588-REG/samsung_mu_pe1t0s_am_1tb_t7_shield_portable.html";

  it("asks the AI when ids differ and refuses a sibling model", async () => {
    const llm = llmReturning("different_model");
    const ev = await evaluateClaim(input(shieldUrl), deps(fakeChannel3({ [shieldUrl]: T7_SHIELD }, { e2dXeQi: T7 }), llm.fetch));
    expect(ev.identity?.relation).toBe("different_model");
    expect(ev.decision.status).toBe("refused");
    expect(llm.calls[0]).toContain("T7 Shield Portable SSD");
    expect(JSON.parse(llm.calls[0]!).tool_choice).toBe("required");
  });

  it("sends the claim to a person when no AI provider answers", async () => {
    const ev = await evaluateClaim(input(shieldUrl), deps(fakeChannel3({ [shieldUrl]: T7_SHIELD }, { e2dXeQi: T7 }), llmDown));
    expect(ev.identity).toBeNull();
    expect(ev.decision.status).toBe("needs_review");
  });

  it("does not call the AI when Channel3 resolves the link to the purchased product", async () => {
    const llm = llmReturning("cannot_tell");
    const url = "https://www.officedepot.com/a/products/mx-master-3s";
    const ev = await evaluateClaim(input(url, "nLZKmNT", 11999), deps(fakeChannel3({ [url]: MX }, {}), llm.fetch));
    expect(ev.decision.status).toBe("approved");
    expect(ev.decision.refundCents).toBe(2000);
    expect(llm.calls).toHaveLength(0);
  });

  it("a cheaper, new 1st-generation listing the AI calls the same as a 2nd-gen purchase goes to a person, not a payout", async () => {
    const gen2: C3Product = { id: "CBwmyTM", title: "Bose QuietComfort Ultra Earbuds (2nd Gen), Black", offers: [] };
    const gen1: C3Product = { id: "Y2alZ03", title: "Bose QuietComfort Ultra Wireless Earbuds Noise Cancelling Bluetooth Headphones, Black", offers: [offer("walmart.com", 249, "new")] };
    const url = "https://www.walmart.com/ip/Bose-QuietComfort-Ultra-Wireless-Earbuds/2655908227";
    const ev = await evaluateClaim({ ...input(url, "CBwmyTM", 29900), purchasedTitle: "Bose QuietComfort Ultra Earbuds (2nd Gen), Black" }, deps(fakeChannel3({ [url]: gen1 }, { CBwmyTM: { ...gen2, title: "QuietComfort Ultra Earbuds" } }), llmReturning("same_product").fetch));
    expect(ev.identity).toMatchObject({ relation: "cannot_tell", method: "llm" });
    expect(ev.identity?.evidence[0]).toMatch(/^Generation check/);
    expect(ev.decision.status).toBe("needs_review");
  });

  it("id-only baseline (ablation) refuses a colour variant the AI would accept", async () => {
    const red: C3Product = { id: "muLXXMd", title: "Artisan Series Tilt-head Stand Mixer", offers: [] };
    const black: C3Product = { id: "nHjGjHW", title: "KitchenAid Artisan Series 5-Quart Tilt-Head Stand Mixer", offers: [offer("kitchenaid.com", 379.99, "new")] };
    const url = "https://www.kitchenaid.com/p.KSM150PSBM.html";
    const c3 = fakeChannel3({ [url]: black }, { muLXXMd: red });
    const bought = { ...input(url, "muLXXMd", 44999), purchasedTitle: "KitchenAid Artisan Series 5-Quart Tilt-Head Stand Mixer, Empire Red" };
    const ai = await evaluateClaim(bought, deps(c3, llmReturning("same_product_other_color").fetch));
    const idOnly = await evaluateClaim(bought, deps(c3, llmDown, { identityMode: "id_only" }));
    expect(ai.decision.status).toBe("approved");
    expect(idOnly.decision.status).toBe("refused");
  });

  it("confirms a missing condition from Channel3's product record before sending the claim to a person", async () => {
    // 2026-10-29: the B&H lookup came back with no condition; the product record said "new".
    const url = "https://www.bhphotovideo.com/c/product/1559836-REG/samsung_mu_pc1t0t_am_1tb_t7_portable_ssd.html";
    const lookupNoCondition: C3Product = { ...T7, offers: [offer("bhphotovideo.com", 230.01, null)] };
    const detailWithCondition: C3Product = { ...T7, offers: [offer("bhphotovideo.com", 230.01, "new")] };
    const ev = await evaluateClaim(input(url), deps(fakeChannel3({ [url]: lookupNoCondition }, { e2dXeQi: detailWithCondition }), llmDown));
    expect(ev.decision.status).toBe("approved");
    expect(ev.decision.refundCents).toBe(4498);
    expect(ev.competitor?.conditionSource).toBe("product_record");
    expect(ev.decision.checks.find((c) => c.id === "condition")?.detail).toContain("product record");
  });

  it("still sends the claim to a person when neither source states a condition", async () => {
    const url = "https://www.bhphotovideo.com/c/product/1559836-REG/samsung_mu_pc1t0t_am_1tb_t7_portable_ssd.html";
    const noCondition: C3Product = { ...T7, offers: [offer("bhphotovideo.com", 230.01, null)] };
    const ev = await evaluateClaim(input(url), deps(fakeChannel3({ [url]: noCondition }, { e2dXeQi: noCondition }), llmDown));
    expect(ev.decision.status).toBe("needs_review");
    expect(ev.competitor?.conditionSource).toBe("none");
  });

  it("does not consult a second source for a resale marketplace", async () => {
    let productCalls = 0;
    const url = "https://www.backmarket.com/en-us/p/logitech-mx-master-3s-mouse-wireless/24c32268";
    const c3 = fakeChannel3({ [url]: MX }, {});
    const counting: Channel3Client = { ...c3, product: async (id) => { productCalls++; return c3.product(id); } };
    const ev = await evaluateClaim(input(url, "nLZKmNT", 14999), deps(counting, llmDown));
    expect(ev.decision.status).toBe("refused");
    expect(productCalls).toBe(0);
  });

  it("sends an unreadable competitor page to a person", async () => {
    const url = "https://www.walmart.com/ip/45918917";
    const ev = await evaluateClaim(input(url), deps(fakeChannel3({ [url]: new Channel3Error(500, "Product extraction failed") }, {}), llmDown));
    expect(ev.decision.status).toBe("needs_review");
    expect(ev.decision.checks[0]?.id).toBe("lookup");
  });
});

describe("verifyClaim", () => {
  beforeEach(async () => {
    resetDbForTests();
    await getDb().run("INSERT INTO catalog (product_id, title, price_cents, currency) VALUES ('nLZKmNT', 'MX Master 3S', 11999, 'USD')");
  });
  async function capturedOrder() {
    const o = await createOrderRow("nLZKmNT");
    await getDb().run("UPDATE orders SET paypal_order_id='PO1', capture_id='CAP1', captured_cents=11999, captured_at='2026-10-29T00:10:00Z', status='captured' WHERE id=?", o.id);
    return o.id;
  }

  it("refunds an approved claim with the verified difference", async () => {
    const orderId = await capturedOrder();
    const url = "https://www.officedepot.com/a/products/mx-master-3s";
    const claim = await fileClaim(orderId, url);
    const refunds: unknown[] = [];
    const done = await verifyClaim(claim.id, deps(fakeChannel3({ [url]: MX }, {}), llmDown, {
      refund: async (r) => {
        refunds.push(r);
        return { claimId: r.claimId, refundId: "RF1", status: "COMPLETED", amountCents: r.amountCents, currency: "USD" };
      },
    }));
    expect(done.status).toBe("refunded");
    expect(done.refund_id).toBe("RF1");
    expect(refunds).toEqual([{ claimId: claim.id, orderId, amountCents: 2000, retailer: "officedepot.com" }]);
  });

  it("rewrites the explanation when an approved refund does not go through", async () => {
    const orderId = await capturedOrder();
    const url = "https://www.officedepot.com/a/products/mx-master-3s";
    const claim = await fileClaim(orderId, url);
    const done = await verifyClaim(claim.id, deps(fakeChannel3({ [url]: MX }, {}), llmDown, {
      refund: async () => { throw new InvariantError(409, "This order already received a price-match refund."); },
    }));
    expect(done.status).toBe("refund_failed");
    const ev = JSON.parse(done.decision_json!);
    expect(ev.explanation.text).toBe("Your claim was approved for $20.00, but the refund could not be completed: This order already received a price-match refund.");
  });

  describe("with a daily limit", () => {
    const DAY = "2026-10-29"; // NOW's day
    const url = "https://www.officedepot.com/a/products/mx-master-3s";
    const paying = (refunds: unknown[]) => async (r: { claimId: string; amountCents: number }) => {
      refunds.push(r);
      return { claimId: r.claimId, refundId: "RF1", status: "COMPLETED", amountCents: r.amountCents, currency: "USD" };
    };

    it("pays while the day stays within the limit, and counts it", async () => {
      await reserveAutoRefund(DAY, 1000, null);
      const claim = await fileClaim(await capturedOrder(), url);
      const refunds: unknown[] = [];
      const done = await verifyClaim(claim.id, deps(fakeChannel3({ [url]: MX }, {}), llmDown, { settings: { ...settings, dailyAutoLimitCents: 3000 }, refund: paying(refunds) as never }));
      expect(done.status).toBe("refunded");
      expect(refunds).toHaveLength(1);
      expect(await autoRefundedOn(DAY)).toBe(3000);
    });

    it("sends the claim that would pass the limit to a person, and PayPal is never asked", async () => {
      await reserveAutoRefund(DAY, 1000, null);
      const claim = await fileClaim(await capturedOrder(), url);
      const refunds: unknown[] = [];
      const done = await verifyClaim(claim.id, deps(fakeChannel3({ [url]: MX }, {}), llmDown, { settings: { ...settings, dailyAutoLimitCents: 2999 }, refund: paying(refunds) as never }));
      expect(done.status).toBe("needs_review");
      expect(refunds).toHaveLength(0);
      expect(await autoRefundedOn(DAY)).toBe(1000);
      const ev = JSON.parse(done.decision_json!);
      expect(ev.decision.checks.find((c: { id: string }) => c.id === "limit")).toMatchObject({ outcome: "review" });
      expect(ev.decision.refundCents).toBe(2000); // what the reviewer is offered
      expect(ev.explanation.text).toBe("This refund is more than the store pays automatically, so a person at the store will look at your claim.");
    });

    it("gives the amount back when the refund does not go through", async () => {
      const claim = await fileClaim(await capturedOrder(), url);
      const done = await verifyClaim(claim.id, deps(fakeChannel3({ [url]: MX }, {}), llmDown, {
        settings: { ...settings, dailyAutoLimitCents: 3000 },
        refund: async () => { throw new InvariantError(409, "This order already received a price-match refund."); },
      }));
      expect(done.status).toBe("refund_failed");
      expect(await autoRefundedOn(DAY)).toBe(0);
    });

    it("counts a refund whose outcome is unknown: it may have been paid", async () => {
      const claim = await fileClaim(await capturedOrder(), url);
      const done = await verifyClaim(claim.id, deps(fakeChannel3({ [url]: MX }, {}), llmDown, {
        settings: { ...settings, dailyAutoLimitCents: 3000 },
        refund: async () => { throw new OutcomeUnknownError("refund:x"); },
      }));
      expect(done.status).toBe("refund_unknown");
      expect(await autoRefundedOn(DAY)).toBe(2000);
    });

    it("does not count a person's approval: the limit is on automatic refunds", async () => {
      const claim = await fileClaim(await capturedOrder(), url);
      const done = await verifyClaim(claim.id, deps(fakeChannel3({ [url]: MX }, {}), llmDown, { settings: { ...settings, dailyAutoLimitCents: 1000 } }));
      expect(done.status).toBe("needs_review");
      const refunds: unknown[] = [];
      const approved = await approveReviewedClaim(claim.id, 2000, "", paying(refunds) as never);
      expect(approved.status).toBe("refunded");
      expect(await autoRefundedOn(DAY)).toBe(0);
    });
  });

  it("never refunds a refused claim", async () => {
    const orderId = await capturedOrder();
    const url = "https://www.backmarket.com/en-us/p/logitech-mx-master-3s-mouse-wireless/24c32268";
    const claim = await fileClaim(orderId, url);
    const done = await verifyClaim(claim.id, deps(fakeChannel3({ [url]: MX }, {}), llmDown));
    expect(done.status).toBe("refused");
    expect(done.refund_id).toBeNull();
  });

  it("will not file a claim on an unpaid order", async () => {
    const o = await createOrderRow("nLZKmNT");
    await expect(fileClaim(o.id, "https://www.officedepot.com/x")).rejects.toThrow(/paid orders/);
  });
});

describe("qualifying retailer", () => {
  it("honours listed stores and the brand's own store; any other store goes to a person", async () => {
    const { isKnownRetailer, brandStore } = await import("@/lib/verifier/retailers");
    expect(isKnownRetailer("bestbuy.com")).toBe(true);
    expect(isKnownRetailer("www.bhphotovideo.com")).toBe(true);
    expect(isKnownRetailer("kitchenaid.com", "KitchenAid Artisan Series Stand Mixer")).toBe(true);
    expect(isKnownRetailer("instantpot.com", "Instant Pot Duo Plus V4")).toBe(true);
    expect(isKnownRetailer("jbl.com", "Flip 6 speaker", ["JBL"])).toBe(true);
    expect(isKnownRetailer("cheap-electronics-deals.shop", "Samsung T7 Portable SSD")).toBe(false);
    expect(isKnownRetailer("samsung-outlet.com", "Samsung T7 Portable SSD")).toBe(false);
    expect(brandStore("t7.com", "Samsung T7 Portable SSD")).toBe(false); // only the leading brand words count
    const d = decide(base({ competitorDomain: "deals4u.shop", offer: offer("deals4u.shop", 99.99, "new") }));
    expect(d.checks.find((c) => c.id === "retailer")?.outcome).toBe("review");
    expect(d.status).toBe("needs_review");
  });

  it("extra stores can be added by the merchant", async () => {
    const { isKnownRetailer } = await import("@/lib/verifier/retailers");
    process.env.MATCHBACK_EXTRA_RETAILERS = "deals4u.shop, www.localcamera.com";
    try {
      expect(isKnownRetailer("deals4u.shop")).toBe(true);
      expect(isKnownRetailer("localcamera.com")).toBe(true);
    } finally {
      delete process.env.MATCHBACK_EXTRA_RETAILERS;
    }
  });
});
