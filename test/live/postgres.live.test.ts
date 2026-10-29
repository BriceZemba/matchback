import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Live: run the app's own data paths against the hosted Postgres (DATABASE_URL), the same SQL the
// SQLite tests cover. Skipped unless LIVE=1 and DATABASE_URL is set. Rows it creates are removed.
// Run: LIVE=1 npx vitest run test/live/postgres.live.test.ts
for (const line of (() => { try { return readFileSync(".env", "utf8"); } catch { return ""; } })().split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim();
}

describe.skipIf(process.env.LIVE !== "1" || !process.env.DATABASE_URL)("live Postgres", () => {
  it("orders, claims with images, PayPal write claims, refunds, findings and the cache", { timeout: 60_000 }, async () => {
    const { getDb, isDuplicateKey } = await import("@/lib/db");
    const { createOrderRow, getOrderRow } = await import("@/lib/paypal/checkout");
    const { takeClaim, releaseClaim } = await import("@/lib/paypal/claims");
    const { fileImageClaim, getClaimImage, claimsForOrder } = await import("@/lib/verifier/run");
    const { activeFinding } = await import("@/lib/watch");
    const db = getDb();
    expect(db.dialect).toBe("postgres");

    const order = await createOrderRow("e2dXeQi");
    const capture = `LIVE-${order.id}`;
    try {
      await db.run("UPDATE orders SET paypal_order_id = ?, capture_id = ?, captured_cents = 27499, captured_at = ?, status = 'captured' WHERE id = ?", `PO-${order.id}`, capture, new Date().toISOString(), order.id);
      expect(await getOrderRow(order.id)).toMatchObject({ status: "captured", captured_cents: 27499 });

      const bytes = new Uint8Array(readFileSync("test/fixtures/bestbuy-t7-screenshot.jpg"));
      const claim = await fileImageClaim(order.id, { bytes, mime: "image/jpeg" }, "fr");
      expect(claim).toMatchObject({ source: "image", status: "verifying", locale: "fr" });
      const image = await getClaimImage(claim.id);
      expect(image?.bytes.byteLength).toBe(bytes.byteLength);
      expect((await claimsForOrder(order.id)).map((c) => c.id)).toEqual([claim.id]);

      expect(await takeClaim(`live:${order.id}`, "test")).toBeNull();
      expect(await takeClaim(`live:${order.id}`, "test")).toMatchObject({ state: "claimed" });
      await releaseClaim(`live:${order.id}`);

      await db.run("INSERT INTO refunds (claim_id, order_id, capture_id, kind, amount_cents, currency, status, created_at) VALUES (?, ?, ?, 'price_match', 100, 'USD', 'completed', ?)", `r1-${order.id}`, order.id, capture, new Date().toISOString());
      const second = await db
        .run("INSERT INTO refunds (claim_id, order_id, capture_id, kind, amount_cents, currency, status, created_at) VALUES (?, ?, ?, 'price_match', 100, 'USD', 'claimed', ?)", `r2-${order.id}`, order.id, capture, new Date().toISOString())
        .then(() => null, (err: unknown) => err);
      expect(isDuplicateKey(second)).toBe(true);
      const sum = (await db.get("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM refunds WHERE capture_id = ?", capture)) as { total: string | number };
      expect(Number(sum.total)).toBe(100);

      await db.run("INSERT INTO watch_findings (id, order_id, domain, offer_url, price_cents, refund_cents, status, evidence_json, found_at) VALUES (?, ?, 'bhphotovideo.com', 'https://x', 23001, 4498, 'suggested', '{}', ?)", `f-${order.id}`, order.id, new Date().toISOString());
      expect(await activeFinding(order.id)).toMatchObject({ refund_cents: 4498 });

      const key = `live:${order.id}`;
      await db.run("INSERT INTO channel3_cache (key, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at", key, "1", "a");
      await db.run("INSERT INTO channel3_cache (key, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at", key, "2", "b");
      expect(await db.get("SELECT json FROM channel3_cache WHERE key = ?", key)).toEqual({ json: "2" });
      await db.run("DELETE FROM channel3_cache WHERE key = ?", key);
    } finally {
      for (const table of ["watch_findings", "refunds", "claims"]) await db.run(`DELETE FROM ${table} WHERE order_id = ?`, order.id);
      await db.run("DELETE FROM orders WHERE id = ?", order.id);
    }
  });
});
