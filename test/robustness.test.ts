import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { C3Product, Channel3Client } from "@/lib/channel3";
import { getDb, resetDbForTests } from "@/lib/db";
import type { LlmProvider } from "@/lib/llm";
import { createOrderRow } from "@/lib/paypal/checkout";
import { OutcomeUnknownError } from "@/lib/paypal/errors";
import { clientKey, overBudget, readForm } from "@/lib/client";
import { fileClaim, fileImageClaim, getClaim, getClaimImage, imageTypeOf, isStale, purgeOldScreenshots, reconcileClaim, reconcileStaleClaims, type ClaimEvidence, type VerifyDeps } from "@/lib/verifier/run";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const provider: LlmProvider = { name: "groq", baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };
const llmDown: typeof fetch = async () => { throw new TypeError("fetch failed"); };
const mouse: C3Product = { id: "nLZKmNT", title: "Logitech MX Master 3S", offers: [{ domain: "officedepot.com", price: { price: 99.99, currency: "USD" }, availability: "InStock", condition: "new", url: "https://www.officedepot.com/a/mx" }] };

function deps(refunds: { claimId: string; amountCents: number }[], refund?: VerifyDeps["refund"]): VerifyDeps {
  const channel3: Channel3Client = {
    async lookup() { return mouse; },
    async product() { return mouse; },
    async priceStats() { return null; },
  };
  return {
    channel3,
    settings: { windowDays: 14, minDiffCents: 100, floorShare: 0.6, allowColorVariants: true },
    identityMode: "ai",
    providers: [provider],
    llmFetch: llmDown,
    refund: refund ?? (async (r) => { refunds.push(r); return { claimId: r.claimId, refundId: "RF-RETRY", status: "COMPLETED", amountCents: r.amountCents, currency: "USD" }; }),
    now: () => new Date(NOW),
  };
}

async function capturedOrder() {
  const o = await createOrderRow("nLZKmNT");
  await getDb().run("UPDATE orders SET paypal_order_id=?, capture_id=?, captured_cents=11999, captured_at=?, status='captured' WHERE id=?", `PO-${o.id}`, `CAP-${o.id}`, "2026-10-29T00:00:00Z", o.id);
  return o.id;
}

async function claimIn(status: string, at: string, evidence: Partial<ClaimEvidence> | null = null) {
  const orderId = await capturedOrder();
  const id = `c-${orderId}`;
  await getDb().run(
    "INSERT INTO claims (id, order_id, competitor_url, status, decision_json, created_at, decided_at, locale) VALUES (?, ?, 'https://www.officedepot.com/a/mx', ?, ?, ?, ?, 'es')",
    id, orderId, status, evidence ? JSON.stringify(evidence) : null, at, status === "verifying" ? null : at,
  );
  return id;
}

const approved = (): Partial<ClaimEvidence> => ({
  decision: { status: "approved", refundCents: 2000, competitorCents: 9999, checks: [] },
  identity: null, competitor: null, purchased: { productId: "nLZKmNT", title: "Logitech MX Master 3S" }, priceContext: null,
  explanation: { source: "template", text: "Confirming with PayPal." },
});

beforeEach(async () => {
  resetDbForTests();
  await getDb().run("INSERT INTO catalog (product_id, title, price_cents, currency) VALUES ('nLZKmNT', 'Logitech MX Master 3S', 11999, 'USD')");
});

describe("claims a crashed run left behind", () => {
  it("are stale only after five minutes, and only while unfinished", () => {
    const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
    expect(isStale({ status: "verifying", created_at: at(6), decided_at: null }, NOW)).toBe(true);
    expect(isStale({ status: "verifying", created_at: at(2), decided_at: null }, NOW)).toBe(false);
    expect(isStale({ status: "refund_unknown", created_at: at(60), decided_at: at(6) }, NOW)).toBe(true);
    expect(isStale({ status: "refunded", created_at: at(60), decided_at: at(60) }, NOW)).toBe(false);
    expect(isStale({ status: "needs_review", created_at: at(60), decided_at: at(60) }, NOW)).toBe(false);
  });

  it("a claim stuck in checking is verified again and refunded", async () => {
    const id = await claimIn("verifying", new Date(NOW - 10 * 60_000).toISOString());
    const refunds: { claimId: string; amountCents: number }[] = [];
    const claim = await reconcileClaim(id, deps(refunds), NOW);
    // Channel3 resolves the link to the purchased product itself, so no AI is needed.
    expect(claim).toMatchObject({ status: "refunded", refund_id: "RF-RETRY" });
    expect(refunds).toEqual([expect.objectContaining({ claimId: id, amountCents: 2000 })]);
  });

  it("a refund with an unknown outcome is settled, and the shopper's note says it went through", async () => {
    const id = await claimIn("refund_unknown", new Date(NOW - 10 * 60_000).toISOString(), approved());
    const refunds: { claimId: string; amountCents: number }[] = [];
    const claim = await reconcileClaim(id, deps(refunds), NOW);
    expect(refunds).toEqual([{ claimId: id, orderId: expect.any(String), amountCents: 2000, retailer: "a competing retailer" }]);
    expect(claim).toMatchObject({ status: "refunded", refund_id: "RF-RETRY" });
    expect(JSON.parse(claim!.decision_json!).explanation.text).toContain("PayPal confirmó");
  });

  it("stays unknown when PayPal still cannot say, and is not retried again within five minutes", async () => {
    const id = await claimIn("refund_unknown", new Date(NOW - 10 * 60_000).toISOString(), approved());
    let calls = 0;
    const stillUnknown: VerifyDeps["refund"] = async () => { calls++; throw new OutcomeUnknownError("refund:x"); };
    expect((await reconcileClaim(id, deps([], stillUnknown), NOW))?.status).toBe("refund_unknown");
    // decided_at moved to now; a second retry right away is not stale and holds no lease.
    expect((await reconcileClaim(id, deps([], stillUnknown), NOW + 1000))?.status).toBe("refund_unknown");
    expect(calls).toBe(1);
  });

  it("only one retry runs at a time (the lease)", async () => {
    const id = await claimIn("approved", new Date(NOW - 10 * 60_000).toISOString(), approved());
    const refunds: { claimId: string; amountCents: number }[] = [];
    await getDb().run("UPDATE claims SET retry_at = ? WHERE id = ?", new Date(NOW - 60_000).toISOString(), id); // another instance took it a minute ago
    expect((await reconcileClaim(id, deps(refunds), NOW))?.status).toBe("approved");
    expect(refunds).toHaveLength(0);
  });

  it("the daily job retries every stale claim and leaves fresh ones alone", async () => {
    const stale = await claimIn("approved", new Date(NOW - 10 * 60_000).toISOString(), approved());
    const fresh = await claimIn("approved", new Date(NOW - 60_000).toISOString(), approved());
    const refunds: { claimId: string; amountCents: number }[] = [];
    const out = await reconcileStaleClaims(deps(refunds), NOW);
    expect(out).toEqual([{ id: stale, status: "refunded" }]);
    expect((await getClaim(fresh))!.status).toBe("approved");
  });
});

describe("per-visitor claim limit", () => {
  it("stops one sender after six claims a minute without blocking others", async () => {
    const orders = await Promise.all(Array.from({ length: 4 }, () => capturedOrder()));
    for (let i = 0; i < 6; i++) await fileClaim(orders[i % 3]!, "https://www.officedepot.com/a/mx", "en", { client: "visitor-a" });
    await expect(fileClaim(orders[0]!, "https://www.officedepot.com/a/mx", "en", { client: "visitor-a" })).rejects.toMatchObject({ status: 429 });
    await expect(fileClaim(orders[3]!, "https://www.officedepot.com/a/mx", "en", { client: "visitor-b" })).resolves.toMatchObject({ status: "verifying" });
  });

  it("hashes the sender's address and never stores it", () => {
    const req = (h: Record<string, string>) => new Request("https://m.test/api/claims", { headers: h });
    const a = clientKey(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).toBe(clientKey(req({ "x-real-ip": "203.0.113.7" })));
    expect(a).not.toContain("203");
    expect(clientKey(req({}))).toBeUndefined();
  });
});

describe("uploaded images", () => {
  it("are recognised by their bytes, not by the declared type", async () => {
    const jpeg = new Uint8Array(readFileSync("test/fixtures/bestbuy-t7-screenshot.jpg"));
    expect(imageTypeOf(jpeg)).toBe("image/jpeg");
    expect(imageTypeOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(imageTypeOf(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();

    const orderId = await capturedOrder();
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    await expect(fileImageClaim(orderId, { bytes: html, mime: "image/png" })).rejects.toMatchObject({ status: 415 });
    // A real JPEG declared as PNG is stored with its true type.
    const claim = await fileImageClaim(orderId, { bytes: jpeg, mime: "image/png" });
    expect(claim.image_mime).toBe("image/jpeg");
  });
});

describe("what the audit found", () => {
  it("gives up on a check that keeps failing: a person takes the claim, and nothing is paid", async () => {
    const id = await claimIn("verifying", new Date(NOW - 31 * 60_000).toISOString());
    const refunds: { claimId: string; amountCents: number }[] = [];
    const claim = await reconcileClaim(id, deps(refunds), NOW);
    expect(claim?.status).toBe("needs_review");
    expect(refunds).toHaveLength(0);
    const ev = JSON.parse(claim!.decision_json!) as ClaimEvidence;
    expect(ev.decision.refundCents).toBe(0);
    expect(ev.decision.checks[0]).toMatchObject({ id: "unfinished", outcome: "review" });
    expect(ev.explanation?.text).toContain("persona"); // the claim was filed in Spanish
  });

  it("deletes screenshots after 60 days and keeps recent ones", async () => {
    const orderId = await capturedOrder();
    const jpeg = new Uint8Array(readFileSync("test/fixtures/bestbuy-t7-screenshot.jpg"));
    const old = await fileImageClaim(orderId, { bytes: jpeg, mime: "image/jpeg" });
    const recent = await fileImageClaim(orderId, { bytes: jpeg, mime: "image/jpeg" });
    await getDb().run("UPDATE claims SET created_at = ? WHERE id = ?", new Date(NOW - 61 * 86_400_000).toISOString(), old.id);
    await getDb().run("UPDATE claims SET created_at = ? WHERE id = ?", new Date(NOW - 59 * 86_400_000).toISOString(), recent.id);
    expect(await purgeOldScreenshots(60, NOW)).toBe(1);
    expect(await getClaimImage(old.id)).toBeUndefined();
    expect(await getClaimImage(recent.id)).toBeDefined();
  });

  it("refuses images over the host's limit and absurdly long links with a clear message", async () => {
    const orderId = await capturedOrder();
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    await expect(fileImageClaim(orderId, { bytes: big, mime: "image/jpeg" })).rejects.toMatchObject({ status: 413 });
    await expect(fileClaim(orderId, `https://www.bestbuy.com/${"a".repeat(2100)}`)).rejects.toMatchObject({ status: 400 });
  });

  it("reads a body that is not a form as an empty form, instead of failing", async () => {
    const form = await readForm(new Request("https://m.test/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    expect(form.get("orderId")).toBeNull();
  });

  it("limits calls per visitor within a window", () => {
    const key = `test:${Math.random()}`;
    expect(overBudget(key, 2, 60_000, NOW)).toBe(false);
    expect(overBudget(key, 2, 60_000, NOW + 1)).toBe(false);
    expect(overBudget(key, 2, 60_000, NOW + 2)).toBe(true);
    expect(overBudget(key, 2, 60_000, NOW + 61_000)).toBe(false);
  });
});
