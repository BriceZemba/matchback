import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDbForTests } from "@/lib/db";
import { merchantSession } from "@/lib/merchant";
import { createOrderRow } from "@/lib/paypal/checkout";

const KEY = "a-long-merchant-key";

beforeEach(async () => {
  resetDbForTests();
  process.env.MERCHANT_KEY = KEY;
  process.env.GROQ_API_KEY = "test-groq-key";
});
afterEach(() => {
  delete process.env.MERCHANT_KEY;
  delete process.env.GROQ_API_KEY;
  vi.unstubAllGlobals();
});

const post = (body: unknown, signedIn = true) =>
  new Request("https://m.test/api/ai/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signedIn ? { cookie: `mb_merchant=${merchantSession(KEY)}` } : {}), "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200)}` },
    body: JSON.stringify(body),
  });

describe("console AI proxy", () => {
  it("requires the store-desk sign-in", async () => {
    const { POST } = await import("@/app/api/ai/responses/route");
    const res = await POST(post({ input: [] }, false));
    expect(res.status).toBe(401);
  });

  it("forwards to Groq with an allowed model, low effort, a token cap, and without fields Groq rejects", async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
      return new Response("event: response.completed\ndata: {}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });
    const { POST } = await import("@/app/api/ai/responses/route");
    const res = await POST(post({ model: "gpt-5-expensive", input: [], store: false, include: ["reasoning.encrypted_content"], previous_response_id: "x", stream: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.groq.com/openai/v1/responses");
    expect(calls[0]!.auth).toBe("Bearer test-groq-key");
    expect(calls[0]!.body).toMatchObject({ model: "openai/gpt-oss-120b", stream: true, reasoning: { effort: "low" }, max_output_tokens: 4000 });
    expect(calls[0]!.body).not.toHaveProperty("store");
    expect(calls[0]!.body).not.toHaveProperty("include");
    expect(calls[0]!.body).not.toHaveProperty("previous_response_id");
  });

  it("waits out a short rate limit once, then answers", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n++;
      return n === 1
        ? new Response(JSON.stringify({ error: { message: "Rate limit reached: tokens per minute" } }), { status: 429, headers: { "retry-after": "0.01" } })
        : new Response("event: response.completed\ndata: {}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });
    const { POST } = await import("@/app/api/ai/responses/route");
    const res = await POST(post({ model: "openai/gpt-oss-20b", input: [] }));
    expect(res.status).toBe(200);
    expect(n).toBe(2);
  });

  it("explains a rate limit it cannot wait out", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "Request too large: tokens per minute (TPM) limit 8000" } }), { status: 413 }));
    const { POST } = await import("@/app/api/ai/responses/route");
    const res = await POST(post({ input: [] }));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/free AI tier/);
  });
});

describe("console data", () => {
  it("builds flat tables with outcome flags, checks per claim and the money kept per order", async () => {
    await getDb().run("INSERT INTO catalog (product_id, title, price_cents, currency) VALUES ('nLZKmNT', 'Logitech MX Master 3S', 11999, 'USD')");
    const o = await createOrderRow("nLZKmNT");
    await getDb().run("UPDATE orders SET paypal_order_id='PO', capture_id='CAP', captured_cents=11999, captured_at='2026-10-29T00:00:00Z', status='captured' WHERE id=?", o.id);
    const decision = { decision: { status: "approved", refundCents: 2000, competitorCents: 9999, checks: [{ id: "window", label: "Within the claim window", outcome: "pass", detail: "ok" }, { id: "identity", label: "Same product", outcome: "pass", detail: "ok" }] }, competitor: { domain: "officedepot.com" }, identity: { relation: "same_product" } };
    await getDb().run("INSERT INTO claims (id, order_id, competitor_url, status, decision_json, created_at, decided_at) VALUES ('c1', ?, 'https://www.officedepot.com/a', 'refunded', ?, '2026-10-29T10:00:00Z', '2026-10-29T10:00:06Z')", o.id, JSON.stringify(decision));
    await getDb().run("INSERT INTO refunds (claim_id, order_id, capture_id, kind, amount_cents, currency, refund_id, status, created_at) VALUES ('c1', ?, 'CAP', 'price_match', 2000, 'USD', 'RF1', 'completed', '2026-10-29T10:00:06Z')", o.id);

    const { loadConsoleData } = await import("@/lib/console-data");
    const data = await loadConsoleData();
    expect(data.claims).toEqual([expect.objectContaining({ id: "c1", outcome: "Refunded", store: "officedepot.com", paid: 119.99, offerPrice: 99.99, gap: 20, refunded: 20, isRefunded: 1, isDecided: 1, isAutomatic: 1, decidedBy: "Matchback" })]);
    expect(data.checks.map((c) => [c.check, c.outcome])).toEqual([["Within the claim window", "Passed"], ["Same product", "Passed"]]);
    expect(data.orders).toEqual([expect.objectContaining({ paid: 119.99, refunded: 20, claimedSale: 119.99, keptSale: 99.99, fullReturn: 119.99, returnAvoided: 1, returnCostAvoided: 25.2 })]);
    // Every store the rules know is there, with the claims it drew.
    expect(data.stores.find((s) => s.id === "officedepot.com")).toEqual({ id: "officedepot.com", storeType: "Listed competitor", claims: 1 });
    expect(data.stores.find((s) => s.id === "bestbuy.com")).toEqual({ id: "bestbuy.com", storeType: "Listed competitor", claims: 0 });
    expect(data.stores.find((s) => s.id === "ebay.com")).toEqual({ id: "ebay.com", storeType: "Resale marketplace", claims: 0 });
    expect(data.claims[0]?.orderRefunded).toBe("yes");
    expect(data.refunds).toEqual([expect.objectContaining({ amount: 20, refundId: "RF1" })]);
  });
});

describe("console evaluation table", () => {
  it("matches the published evaluation totals", async () => {
    const { default: rows } = await import("@/lib/eval-table.json");
    const total = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + Number(r[k]), 0);
    expect(rows).toHaveLength(75);
    expect(total("isTrap")).toBe(52);
    expect(total("matchbackPaidTrap")).toBe(0);
    expect(total("matchbackWronglyRefunded")).toBe(0);
    expect(total("naivePaidTrap")).toBe(22);
    expect(Math.round(total("naiveWronglyRefunded") * 100) / 100).toBe(2592.25);
  });
});

describe("console report", () => {
  it("gives every widget a place, with no two overlapping (Studio drops one that overlaps)", async () => {
    const { consoleReport } = await import("@/app/merchant/console/studio/initial-report");
    for (const page of consoleReport.pages) {
      const layout = page.widgetLayout as Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }>;
      expect(Object.keys(layout).sort(), page.id).toEqual(Object.keys(page.widgets ?? {}).sort());
      const ids = Object.keys(layout);
      for (const a of ids) {
        for (const b of ids) {
          if (a >= b) continue;
          const [p, q] = [layout[a]!, layout[b]!];
          const apart = p.xTrack + p.xSpan <= q.xTrack || q.xTrack + q.xSpan <= p.xTrack || p.yTrack + p.ySpan <= q.yTrack || q.yTrack + q.ySpan <= p.yTrack;
          expect(apart, `${page.id}: ${a} overlaps ${b}`).toBe(true);
        }
      }
    }
  });
});
