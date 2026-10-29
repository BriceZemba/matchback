import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { C3Offer, C3Product, Channel3Client } from "@/lib/channel3";
import { getDb, resetDbForTests } from "@/lib/db";
import type { LlmProvider } from "@/lib/llm";
import { createOrderRow } from "@/lib/paypal/checkout";
import { imageMatchesPurchase, normalizeDomain, parseExtraction, readOfferImage, resolveListing, storeDomainFor, type Extraction } from "@/lib/verifier/image-intake";
import { fileImageClaim, verifyClaim, type VerifyDeps } from "@/lib/verifier/run";

const offer = (domain: string, price: number, condition: string | null = "new"): C3Offer => ({ domain, price: { price, currency: "USD" }, availability: "InStock", condition, url: `https://buy.example/${domain}` });
const T7: C3Product = { id: "e2dXeQi", title: "Samsung T7 Portable SSD 1TB", offers: [offer("bestbuy.com", 259.99), offer("bhphotovideo.com", 230.01)] };
const T9: C3Product = { id: "T9xxxx", title: "Samsung T9 Portable SSD 2TB", offers: [offer("target.com", 199.99)] };
const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  product: "Samsung External SSD", brand: "Samsung", model: null, store: "Best Buy", storeDomain: "bestbuy.com",
  priceCents: 25999, currency: "USD", conditionWords: [], urlVisible: null, confidence: "high", ...over,
});

function fakeChannel3(opts: { byId?: Record<string, C3Product>; byUrl?: Record<string, C3Product>; search?: C3Product[] } = {}): Channel3Client {
  return {
    async lookup(url) { const p = opts.byUrl?.[url]; if (!p) throw new Error("not found"); return p; },
    async product(id) { const p = opts.byId?.[id]; if (!p) throw new Error("no product"); return p; },
    async priceStats() { return null; },
    async search() { return opts.search ?? []; },
  };
}

describe("parseExtraction", () => {
  it("converts the price to cents, normalises the store domain and condition words", () => {
    const ex = parseExtraction({ product: " Samsung T7 ", price: 259.99, store: "Best Buy", store_domain: "https://www.BestBuy.com/site/x", condition_words: ["Open Box"], confidence: "high" });
    expect(ex).toMatchObject({ product: "Samsung T7", priceCents: 25999, storeDomain: "bestbuy.com", conditionWords: ["open box"], confidence: "high" });
  });
  it("treats unknown confidence as low and drops a non-positive price", () => {
    expect(parseExtraction({ product: "x", price: 0, confidence: "very" })).toMatchObject({ priceCents: null, confidence: "low" });
  });
  it("maps a store name to its domain when the AI gives none", () => {
    expect(parseExtraction({ product: "x", store: "Best Buy", price: 1, confidence: "high" }).storeDomain).toBe("bestbuy.com");
    expect(parseExtraction({ product: "x", store: "B&H Photo", price: 1, confidence: "high" }).storeDomain).toBe("bhphotovideo.com");
    expect(storeDomainFor("Abt Electronics")).toBe("abtelectronics.com");
  });
  it("normalises domains", () => {
    expect(normalizeDomain("www.target.com")).toBe("target.com");
    expect(normalizeDomain("Best Buy")).toBeNull();
  });
});

describe("readOfferImage", () => {
  it("sends the image as a data URL and parses the AI's answer", async () => {
    const bodies: string[] = [];
    const fetch: typeof globalThis.fetch = async (_u, init) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "report_offer", arguments: JSON.stringify({ product: "Samsung External SSD", brand: "Samsung", store: "Best Buy", store_domain: "bestbuy.com", price: 259.99, condition_words: [], confidence: "high" }) } }] } }] }), { status: 200 });
    };
    const provider: LlmProvider = { name: "groq", baseUrl: "https://llm.test/v1", apiKey: "k", model: "qwen/qwen3.8-27b" };
    const out = await readOfferImage({ bytes: readFileSync("test/fixtures/bestbuy-t7-screenshot.jpg"), mime: "image/jpeg" }, { providers: [provider], fetch });
    expect(out?.extraction).toMatchObject({ storeDomain: "bestbuy.com", priceCents: 25999 });
    const sent = JSON.parse(bodies[0]!);
    expect(sent.messages[1].content[1].image_url.url.startsWith("data:image/jpeg;base64,")).toBe(true);
  });
});

describe("resolveListing", () => {
  it("prefers the purchased product's own offer at the store in the image", async () => {
    const r = await resolveListing(extraction(), { id: "e2dXeQi", title: "Samsung T7 Portable SSD 1TB" }, fakeChannel3({ byId: { e2dXeQi: T7 }, search: [T9] }));
    expect(r).toMatchObject({ ok: true, matchedBy: "purchased_product_offer", domain: "bestbuy.com" });
  });
  it("uses a link visible in the image first", async () => {
    const url = "https://www.bestbuy.com/site/t7/123";
    const r = await resolveListing(extraction({ urlVisible: url }), { id: "e2dXeQi", title: "Samsung T7 Portable SSD 1TB" }, fakeChannel3({ byUrl: { [url]: T7 } }));
    expect(r).toMatchObject({ ok: true, matchedBy: "link_in_image" });
  });
  it("falls back to search when the purchased product has no offer at that store", async () => {
    const r = await resolveListing(extraction({ store: "Target", storeDomain: "target.com" }), { id: "e2dXeQi", title: "Samsung T7 Portable SSD 1TB" }, fakeChannel3({ byId: { e2dXeQi: T7 }, search: [T9] }));
    expect(r).toMatchObject({ ok: true, matchedBy: "text_search" });
    if (r.ok) expect(r.product.id).toBe("T9xxxx");
  });
  it("picks the search result closest to the purchased product, not the first one", async () => {
    // 2026-10-29 live: a vague image ("Samsung External SSD") first matched a Samsung P7 at Best Buy.
    const P7: C3Product = { id: "P7xxxx", title: "Portable SSD P7 External SSD USB4", offers: [offer("bestbuy.com", 285.99)] };
    const T7bb: C3Product = { id: "T7bbxx", title: "Samsung T7 1TB External USB 3.2 Gen 2 Portable SSD", offers: [offer("bestbuy.com", 259.99)] };
    const own: C3Product = { ...T7, offers: [offer("bhphotovideo.com", 230.01)] }; // no Best Buy offer on our record
    const r = await resolveListing(extraction(), { id: "e2dXeQi", title: "Samsung T7 Portable SSD 1TB" }, fakeChannel3({ byId: { e2dXeQi: own }, search: [P7, T7bb] }));
    expect(r.ok && r.product.id).toBe("T7bbxx");
  });
  it("prefers the listing whose price matches the image over a closer-worded other edition", async () => {
    // 2026-10-29 live, Best Buy-limited search: the plain T7 at $259.99 (the screenshot price) vs a T7 Shield 1TB.
    const shield: C3Product = { id: "kC5010l", title: "Samsung T7 Shield 1TB Portable SSD", offers: [offer("bestbuy.com", 574.99)] };
    const plain: C3Product = { id: "DMBm3wB", title: "Samsung T7 Portable Solid State Drive", offers: [offer("bestbuy.com", 259.99)] };
    const own: C3Product = { ...T7, offers: [offer("bhphotovideo.com", 230.01)] };
    const r = await resolveListing(extraction(), { id: "e2dXeQi", title: "Samsung T7 Portable SSD 1TB (Titan Gray)" }, fakeChannel3({ byId: { e2dXeQi: own }, search: [shield, plain] }));
    expect(r.ok && r.product.id).toBe("DMBm3wB");
  });
  it("explains when the store cannot be identified or has no listing", async () => {
    expect(await resolveListing(extraction({ store: null, storeDomain: null }), { id: "e2dXeQi", title: "Samsung T7 Portable SSD 1TB" }, fakeChannel3())).toMatchObject({ ok: false, reason: expect.stringContaining("store") });
    expect(await resolveListing(extraction({ storeDomain: "abt.com" }), { id: "e2dXeQi", title: "Samsung T7 Portable SSD 1TB" }, fakeChannel3({ byId: { e2dXeQi: T7 } }))).toMatchObject({ ok: false });
  });
});

describe("screenshot claims end to end (fake vision, Channel3, PayPal)", () => {
  const provider: LlmProvider = { name: "groq", baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };
  const llm = (read: Record<string, unknown>): typeof fetch => async (_u, init) => {
    const body = JSON.parse(String(init?.body));
    const tool = body.tools[0].function.name as string;
    const args = tool === "report_offer" ? read : tool === "write_explanation" ? { text: "Short explanation without amounts." } : { relation: "cannot_tell", evidence: [] };
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: tool, arguments: JSON.stringify(args) } }] } }] }), { status: 200 });
  };
  const deps = (llmFetch: typeof fetch, refunds: unknown[]): VerifyDeps => ({
    channel3: fakeChannel3({ byId: { e2dXeQi: T7 } }),
    settings: { windowDays: 14, minDiffCents: 100, floorShare: 0.6, allowColorVariants: true },
    identityMode: "ai",
    providers: [provider],
    llmFetch,
    refund: async (r) => { refunds.push(r); return { claimId: r.claimId, refundId: "RF1", status: "COMPLETED", amountCents: r.amountCents, currency: "USD" }; },
    now: () => new Date("2026-10-29T12:00:00Z"),
  });

  beforeEach(async () => {
    process.env.MATCHBACK_DB = "data/test-uploads/x.db"; // uploads go to data/test-uploads/uploads
    resetDbForTests();
    await getDb().run("INSERT INTO catalog (product_id, title, price_cents, currency) VALUES ('e2dXeQi', 'Samsung T7 Portable SSD 1TB', 27499, 'USD')");
  });
  async function capturedOrder() {
    const o = await createOrderRow("e2dXeQi");
    await getDb().run("UPDATE orders SET paypal_order_id='PO1', capture_id='CAP1', captured_cents=27499, captured_at='2026-10-29T00:00:00Z', status='captured' WHERE id=?", o.id);
    return o.id;
  }
  const image = { bytes: new Uint8Array(readFileSync("test/fixtures/bestbuy-t7-screenshot.jpg")), mime: "image/jpeg" };

  it("refunds from the store's live price, not the price in the image", async () => {
    const refunds: { amountCents: number }[] = [];
    const claim = await fileImageClaim(await capturedOrder(), image);
    // The image claims $199.99; Best Buy's live price for the T7 is $259.99.
    const done = await verifyClaim(claim.id, deps(llm({ product: "Samsung External SSD", store: "Best Buy", store_domain: "bestbuy.com", price: 199.99, condition_words: [], confidence: "high" }), refunds));
    expect(done.status).toBe("refunded");
    expect(refunds[0]!.amountCents).toBe(27499 - 25999);
    const ev = JSON.parse(done.decision_json!);
    expect(ev.image.matchedBy).toBe("purchased_product_offer");
    expect(ev.decision.checks.find((c: { id: string }) => c.id === "image_price").detail).toContain("Matchback always uses the live price");
  });

  it("refuses when the image itself says open box", async () => {
    const refunds: unknown[] = [];
    const claim = await fileImageClaim(await capturedOrder(), image);
    const done = await verifyClaim(claim.id, deps(llm({ product: "Samsung T7", store: "Best Buy", store_domain: "bestbuy.com", price: 229.99, condition_words: ["Open-Box Excellent"], confidence: "high" }), refunds));
    expect(done.status).toBe("refused");
    expect(refunds).toHaveLength(0);
  });

  it("sends the claim to a person when the store can't be read from the image", async () => {
    const claim = await fileImageClaim(await capturedOrder(), image);
    const done = await verifyClaim(claim.id, deps(llm({ product: "SSD", store: null, store_domain: null, price: 199.99, condition_words: [], confidence: "low" }), []));
    expect(done.status).toBe("needs_review");
  });

  it("sends a search-matched listing that is a different product to a person, not a refusal", async () => {
    const shield: C3Product = { id: "SHxxxx", title: "Samsung T7 Shield Portable SSD 2TB", offers: [offer("bestbuy.com", 347.83)] };
    const own: C3Product = { ...T7, offers: [offer("bhphotovideo.com", 230.01)] };
    const claim = await fileImageClaim(await capturedOrder(), image);
    const d = deps(async (_u, init) => {
      const body = JSON.parse(String(init?.body));
      const tool = body.tools[0].function.name as string;
      const args = tool === "report_offer" ? { product: "Samsung External SSD", store: "Best Buy", price: 259.99, condition_words: [], confidence: "high" }
        : tool === "report_identity" ? { relation: "different_model", evidence: ["Shield"] } : { text: "Short explanation without amounts." };
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: tool, arguments: JSON.stringify(args) } }] } }] }), { status: 200 });
    }, []);
    d.channel3 = fakeChannel3({ byId: { e2dXeQi: own }, search: [shield] });
    const done = await verifyClaim(claim.id, d);
    expect(done.status).toBe("needs_review");
    const ev = JSON.parse(done.decision_json!);
    expect(ev.decision.checks.map((c: { id: string }) => c.id)).toEqual(["image_read", "listing"]);
  });

  it("rejects an unsupported file type and an empty file", async () => {
    const id = await capturedOrder();
    await expect(fileImageClaim(id, { bytes: new Uint8Array([1, 2]), mime: "application/pdf" })).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(fileImageClaim(id, { bytes: new Uint8Array(), mime: "image/png" })).rejects.toThrow(/5 MB/);
  });
});

describe("imageMatchesPurchase", () => {
  const ex = (over: Partial<Extraction>) => extraction({ brand: null, model: null, ...over });
  it("accepts an image of the purchased product", () => {
    expect(imageMatchesPurchase(ex({ brand: "GoPro", product: "HERO12 Black" }), "GoPro HERO12 Black Action Camera").ok).toBe(true);
    expect(imageMatchesPurchase(ex({ product: "Samsung External SSD" }), "Samsung T7 Portable SSD 1TB").ok).toBe(true);
    expect(imageMatchesPurchase(ex({ brand: "Instant Brands", product: "Duo Plus pressure cooker" }), "Instant Pot Duo Plus V4 Pressure Cooker").ok).toBe(true);
  });
  it("rejects an image of another product (live case 2026-10-29: Samsung SSD on a GoPro order)", () => {
    expect(imageMatchesPurchase(ex({ brand: "Samsung", product: "Samsung External SSD" }), "GoPro HERO12 Black Action Camera")).toEqual({ ok: false, shown: "Samsung Samsung External SSD" });
    expect(imageMatchesPurchase(ex({ brand: "Sony", product: "Action Camera" }), "GoPro HERO12 Black Action Camera").ok).toBe(false);
  });
});

describe("screenshot of another product at a store that sells ours cheaper", () => {
  const GOPRO: C3Product = { id: "m7BdhGq", title: "GoPro HERO12 Black Action Camera", offers: [offer("bestbuy.com", 295.99)] };
  beforeEach(async () => {
    resetDbForTests();
    await getDb().run("INSERT INTO catalog (product_id, title, price_cents, currency) VALUES ('m7BdhGq', 'GoPro HERO12 Black Action Camera', 34999, 'USD')");
  });
  it("goes to a person instead of refunding", async () => {
    const o = await createOrderRow("m7BdhGq");
    await getDb().run("UPDATE orders SET paypal_order_id='PO9', capture_id='CAP9', captured_cents=34999, captured_at='2026-10-29T00:00:00Z', status='captured' WHERE id=?", o.id);
    const claim = await fileImageClaim(o.id, { bytes: new Uint8Array(readFileSync("test/fixtures/bestbuy-t7-screenshot.jpg")), mime: "image/jpeg" });
    const refunds: unknown[] = [];
    const llm: typeof fetch = async (_u, init) => {
      const tool = JSON.parse(String(init?.body)).tools[0].function.name as string;
      const args = tool === "report_offer"
        ? { product: "Samsung External SSD", brand: "Samsung", store: "Best Buy", store_domain: "bestbuy.com", price: 259.99, condition_words: [], confidence: "high" }
        : { text: "A person will look at this claim." };
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: tool, arguments: JSON.stringify(args) } }] } }] }), { status: 200 });
    };
    const done = await verifyClaim(claim.id, {
      channel3: fakeChannel3({ byId: { m7BdhGq: GOPRO } }),
      settings: { windowDays: 14, minDiffCents: 100, floorShare: 0.6, allowColorVariants: true },
      identityMode: "ai",
      providers: [{ name: "groq", baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" }],
      llmFetch: llm,
      refund: async (r) => { refunds.push(r); return { claimId: r.claimId, refundId: "RF", status: "COMPLETED", amountCents: r.amountCents, currency: "USD" }; },
      now: () => new Date("2026-10-29T12:00:00Z"),
    });
    expect(done.status).toBe("needs_review");
    expect(refunds).toHaveLength(0);
    const ev = JSON.parse(done.decision_json!);
    expect(ev.decision.refundCents).toBe(0);
    expect(ev.decision.checks.find((c: { id: string }) => c.id === "image_product").outcome).toBe("review");
  });
});
