import { beforeEach, describe, expect, it } from "vitest";
import type { C3Product, Channel3Client } from "@/lib/channel3";
import { cachedChannel3 } from "@/lib/channel3-cache";
import { resetDbForTests } from "@/lib/db";

function counting(products: C3Product[]) {
  let calls = 0;
  let i = 0;
  const client: Channel3Client = {
    async lookup() {
      calls++;
      return products[Math.min(i++, products.length - 1)]!;
    },
    async product(id) {
      calls++;
      return { id, title: "detail" };
    },
    async priceStats() {
      calls++;
      return null;
    },
  };
  return { client, calls: () => calls };
}

const v1: C3Product = { id: "A", title: "first answer" };
const v2: C3Product = { id: "A", title: "second answer" };

describe("cachedChannel3", () => {
  beforeEach(() => resetDbForTests());

  it("reuses an answer within the TTL and asks again after it", async () => {
    let t = Date.parse("2026-10-29T10:00:00Z");
    const inner = counting([v1, v2]);
    const c = cachedChannel3(inner.client, resetDbForTests(), { mode: "ttl", ttlMs: 60_000, now: () => t });

    expect((await c.lookup("https://x.test/p")).title).toBe("first answer");
    t += 30_000;
    expect((await c.lookup("https://x.test/p")).title).toBe("first answer");
    expect(inner.calls()).toBe(1);
    t += 60_000;
    expect((await c.lookup("https://x.test/p")).title).toBe("second answer");
    expect(inner.calls()).toBe(2);
  });

  it("frozen mode replays stored answers however old they are", async () => {
    let t = Date.parse("2026-10-29T10:00:00Z");
    const db = resetDbForTests();
    const inner = counting([v1, v2]);
    await cachedChannel3(inner.client, db, { mode: "ttl", now: () => t }).lookup("https://x.test/p");
    t += 30 * 86_400_000;
    const frozen = cachedChannel3(inner.client, db, { mode: "frozen", now: () => t });
    expect((await frozen.lookup("https://x.test/p")).title).toBe("first answer");
    expect(inner.calls()).toBe(1);
  });

  it("never caches an error", async () => {
    const db = resetDbForTests();
    let fail = true;
    const inner: Channel3Client = {
      async lookup() {
        if (fail) throw new Error("Product extraction failed");
        return v1;
      },
      product: async (id) => ({ id, title: "d" }),
      priceStats: async () => null,
    };
    const c = cachedChannel3(inner, db, { mode: "frozen" });
    await expect(c.lookup("https://x.test/p")).rejects.toThrow();
    fail = false;
    expect((await c.lookup("https://x.test/p")).title).toBe("first answer");
  });
});
