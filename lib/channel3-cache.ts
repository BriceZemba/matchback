import { createHash } from "node:crypto";
import { Channel3Error, type Channel3Client } from "@/lib/channel3";
import type { Db } from "@/lib/db";

// A cache in front of Channel3. Live Channel3 answers vary between calls (an offer's condition can be
// missing and then present a minute later), so:
//   - "ttl"    (default): reuse an answer for `ttlMs`, then ask again;
//   - "frozen": replay stored answers forever and only call Channel3 for keys never seen — used by the
//               evaluation and the filmed demo so their inputs cannot drift;
//   - "off":    always call Channel3.
// Errors are not cached unless `cacheErrors` is set (the evaluation sets it so failures stay frozen too).

export type CacheMode = "ttl" | "frozen" | "off";

export function cachedChannel3(
  inner: Channel3Client,
  db: Db,
  opts: { mode?: CacheMode; ttlMs?: number; now?: () => number; cacheErrors?: boolean } = {},
): Channel3Client {
  const mode = opts.mode ?? "ttl";
  const ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
  const now = opts.now ?? Date.now;
  if (mode === "off") return inner;

  async function through<T>(key: string, fetchFresh: () => Promise<T>): Promise<T> {
    const row = await db.get("SELECT json, fetched_at FROM channel3_cache WHERE key = ?", key) as { json: string; fetched_at: string } | undefined;
    if (row && (mode === "frozen" || now() - Date.parse(row.fetched_at) < ttlMs)) {
      const cached = JSON.parse(row.json) as T | { __error: { status: Channel3Error["status"]; message: string } };
      if (cached && typeof cached === "object" && "__error" in cached) throw new Channel3Error(cached.__error.status, cached.__error.message);
      return cached as T;
    }
    let value: T;
    try {
      value = await fetchFresh();
    } catch (err) {
      // Only the evaluation freezes failures (so a re-run cannot change its inputs); the app retries them.
      if (opts.cacheErrors && err instanceof Channel3Error) {
        await db.run("INSERT INTO channel3_cache (key, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at", key, JSON.stringify({ __error: { status: err.status, message: err.message } }), new Date(now()).toISOString());
      }
      throw err;
    }
    await db.run("INSERT INTO channel3_cache (key, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at", key, JSON.stringify(value), new Date(now()).toISOString());
    return value;
  }

  return {
    lookup: (url) => through(`lookup:${url}`, () => inner.lookup(url)),
    product: (id) => through(`product:${id}`, () => inner.product(id)),
    priceStats: (id) => through(`stats:${id}`, () => inner.priceStats(id)),
    ...(inner.search
      ? {
          // Image searches are keyed by a hash of the image so the same screenshot replays in frozen mode.
          search: (query: { text?: string; base64Image?: string; websiteDomain?: string }, limit?: number) =>
            through(`search:${query.websiteDomain ?? ""}:${query.text ?? ""}:${query.base64Image ? createHash("sha256").update(query.base64Image).digest("hex").slice(0, 32) : ""}:${limit ?? 10}`, () => inner.search!(query, limit)),
        }
      : {}),
  };
}

export function cacheModeFromEnv(env: NodeJS.ProcessEnv = process.env): CacheMode {
  const v = env.MATCHBACK_C3_CACHE;
  return v === "frozen" || v === "off" ? v : "ttl";
}
