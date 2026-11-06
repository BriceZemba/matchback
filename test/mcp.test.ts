import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/mcp/route";
import { getDb, resetDbForTests } from "@/lib/db";
import { handleMcp, TOOLS, type McpContext } from "@/lib/mcp";
import { createOrderRow } from "@/lib/paypal/checkout";
import { getClaim, type ClaimEvidence, type ClaimRow } from "@/lib/verifier/run";

const ORIGIN = "https://matchback.example";

const evidence = (status: "approved" | "refused" | "needs_review"): ClaimEvidence => ({
  decision: {
    status,
    refundCents: status === "approved" ? 2000 : 0,
    competitorCents: 9999,
    checks: [
      { id: "window", label: "Within the claim window", outcome: "pass", detail: "Paid today." },
      { id: "identity", label: "Same product", outcome: status === "refused" ? "fail" : "pass", detail: "Compared by the AI." },
    ],
  },
  identity: { relation: "same_product", method: "llm", evidence: [], provider: "groq" },
  competitor: { productId: "x", title: "Logitech MX Master 3S", domain: "officedepot.com", condition: "new", conditionSource: "page_lookup" },
  purchased: { productId: "nLZKmNT", title: "MX Master 3S" },
  priceContext: null,
  explanation: { text: "The same mouse is $20.00 cheaper at Office Depot.", source: "ai", provider: "groq" },
});

/** Stands in for verifyClaim: records the decision and, for an approval, a completed PayPal refund. */
function fakeVerify(status: "approved" | "refused" | "needs_review") {
  return async (claimId: string): Promise<ClaimRow> => {
    const claim = (await getClaim(claimId))!;
    const final = status === "approved" ? "refunded" : status;
    await getDb().run("UPDATE claims SET status = ?, decision_json = ?, decided_at = ? WHERE id = ?", final, JSON.stringify(evidence(status)), "2026-10-29T10:00:08Z", claimId);
    if (status === "approved") {
      await getDb().run(
        "INSERT INTO refunds (claim_id, order_id, capture_id, kind, amount_cents, currency, refund_id, status, created_at) VALUES (?, ?, 'CAP1', 'price_match', 2000, 'USD', 'RF1', 'completed', ?)",
        claimId, claim.order_id, "2026-10-29T10:00:08Z",
      );
    }
    return (await getClaim(claimId))!;
  };
}

const ctx = (over: Partial<McpContext> = {}): McpContext => ({ origin: ORIGIN, verify: fakeVerify("approved"), ...over });
const call = async (name: string, args: Record<string, unknown>, c = ctx()) => {
  const reply = await handleMcp({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, c);
  return (reply as { result: { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> } }).result;
};

async function paidOrder() {
  const o = await createOrderRow("nLZKmNT");
  await getDb().run("UPDATE orders SET paypal_order_id='PO1', capture_id='CAP1', captured_cents=11999, captured_at='2026-10-29T00:10:00Z', status='captured' WHERE id=?", o.id);
  return o.id;
}

describe("MCP server", () => {
  beforeEach(async () => {
    resetDbForTests();
    await getDb().run("INSERT INTO catalog (product_id, title, price_cents, currency) VALUES ('nLZKmNT', 'MX Master 3S', 11999, 'USD')");
  });

  it("answers initialize with the client's protocol version when supported, and lists the four tools", async () => {
    const init = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, ctx()) as { result: { protocolVersion: string; capabilities: object } };
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.capabilities).toEqual({ tools: { listChanged: false } });
    const unknown = await handleMcp({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, ctx()) as { result: { protocolVersion: string } };
    expect(unknown.result.protocolVersion).toBe("2025-06-18");
    const list = await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/list" }, ctx()) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(["get_price_match_policy", "get_order", "file_price_match_claim", "get_claim"]);
    expect(TOOLS.every((t) => t.inputSchema.type === "object")).toBe(true);
  });

  it("sends nothing back for notifications and answers each request of a batch", async () => {
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx())).toBeNull();
    const batch = await handleMcp([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: "a", method: "ping" }], ctx());
    expect(batch).toEqual([{ jsonrpc: "2.0", id: "a", result: {} }]);
  });

  it("returns JSON-RPC errors for bad requests, unknown methods and unknown tools", async () => {
    expect(await handleMcp({ hello: 1 }, ctx())).toMatchObject({ error: { code: -32600 } });
    expect(await handleMcp({ jsonrpc: "2.0", id: 1, method: "resources/list" }, ctx())).toMatchObject({ id: 1, error: { code: -32601 } });
    expect(await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "refund_anything" } }, ctx())).toMatchObject({ error: { code: -32602 } });
  });

  it("states the store's policy, including what is never paid automatically", async () => {
    const r = await call("get_price_match_policy", {});
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ claimWindowDays: 14, smallestDifference: "$1.00", refunds: expect.stringContaining("One price-match refund per order") });
    expect(r.structuredContent!.storesThatCount).toContain("bestbuy.com");
  });

  it("looks up a paid order and refuses ids that are malformed or unknown", async () => {
    const orderId = await paidOrder();
    const r = await call("get_order", { order_id: orderId });
    expect(r.structuredContent).toMatchObject({
      product: "MX Master 3S", paid: "$119.99 USD", status: "paid", claimWindowCloses: "2026-11-12T00:10:00.000Z",
      priceMatchRefundAlreadyPaid: false, claims: [], orderPage: `${ORIGIN}/orders/${orderId}`,
    });
    expect((await call("get_order", { order_id: "not-an-id" })).isError).toBe(true);
    const unknown = await call("get_order", { order_id: "00000000-0000-4000-8000-000000000000" });
    expect(unknown).toMatchObject({ isError: true, content: [{ text: "No order has that id." }] });
  });

  it("files a claim through the same checks as the order page and reports the PayPal refund", async () => {
    const orderId = await paidOrder();
    const r = await call("file_price_match_claim", { order_id: orderId, competitor_url: "https://www.officedepot.com/a/products/mx-master-3s", language: "fr" });
    expect(r.isError).toBeUndefined();
    const s = r.structuredContent!;
    expect(s).toMatchObject({ orderId, status: "refunded", refunded: "$20.00 USD", competitorPrice: "$99.99", competitor: { store: "officedepot.com" } });
    expect(s.receipt).toBe(`${ORIGIN}/claims/${s.claimId}`);
    expect((s.checks as unknown[]).length).toBe(2);
    expect((await getClaim(s.claimId as string))!.locale).toBe("fr");

    const followed = await call("get_claim", { claim_id: s.claimId });
    expect(followed.structuredContent).toMatchObject({ status: "refunded", refunded: "$20.00 USD" });
    const order = await call("get_order", { order_id: orderId });
    expect(order.structuredContent).toMatchObject({ priceMatchRefundAlreadyPaid: true, claims: [{ claimId: s.claimId, status: "refunded" }] });
  });

  it("reports a claim sent to a person without any payment", async () => {
    const orderId = await paidOrder();
    const r = await call("file_price_match_claim", { order_id: orderId, competitor_url: "https://www.bestbuy.com/p/1" }, ctx({ verify: fakeVerify("needs_review") }));
    expect(r.structuredContent).toMatchObject({ status: "needs_review", refunded: null, note: expect.stringContaining("Nothing has been paid") });
  });

  it("answers 'verifying' when checks outlast the wait, and keeps them running", async () => {
    const orderId = await paidOrder();
    const kept: Promise<unknown>[] = [];
    let finish!: () => void;
    const slow = (claimId: string) => new Promise<ClaimRow>((resolve) => { finish = () => resolve(fakeVerify("approved")(claimId) as unknown as ClaimRow); });
    const r = await call("file_price_match_claim", { order_id: orderId, competitor_url: "https://www.officedepot.com/x" }, ctx({ verify: slow, waitMs: 10, background: (w) => kept.push(w) }));
    expect(r.structuredContent).toMatchObject({ status: "verifying" });
    expect(kept).toHaveLength(1);
    finish();
    await kept[0];
  });

  it("refuses unpaid orders, bad links and missing arguments as tool errors, not protocol errors", async () => {
    const unpaid = (await createOrderRow("nLZKmNT")).id;
    expect(await call("file_price_match_claim", { order_id: unpaid, competitor_url: "https://www.bestbuy.com/p/1" })).toMatchObject({ isError: true, content: [{ text: "Price-match claims are for paid orders only." }] });
    const orderId = await paidOrder();
    expect((await call("file_price_match_claim", { order_id: orderId, competitor_url: "ftp://x" })).isError).toBe(true);
    expect(await call("file_price_match_claim", { order_id: orderId })).toMatchObject({ isError: true, content: [{ text: "competitor_url is required." }] });
    expect(await call("get_claim", { claim_id: "00000000-0000-4000-8000-000000000000" })).toMatchObject({ isError: true, content: [{ text: "No claim has that id." }] });
  });
});

describe("MCP route", () => {
  it("answers GET with 405, as a server without a stream must", async () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("answers a body that is not JSON with a parse error, and a notification with 202", async () => {
    const bad = await POST(new Request("https://m.example/api/mcp", { method: "POST", body: "{", headers: { "content-type": "application/json" } }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: -32700 } });
    const note = await POST(new Request("https://m.example/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }));
    expect(note.status).toBe(202);
  });
});
