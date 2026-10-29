// Claim-path test with real retailer product URLs (found by web search on
// 2026-10-28), including variant and condition traps a price-match claim might use.
// Asks Channel3 to resolve each URL (REST with CHANNEL3_API_KEY, else keyless MCP).
//
// Usage: node spikes/channel3/url-lookup.mjs

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");

// group: URLs in the same group are the same product; trap says why a claim should fail.
const CASES = [
  { group: "sony-xm5", note: "black", url: "https://www.bestbuy.com/site/reviews/sony-wh-1000xm5-wireless-noise-cancelling-over-the-ear-headphones-black/6505727" },
  { group: "sony-xm5", note: "silver (colour variant)", url: "https://www.bestbuy.com/site/reviews/sony-wh-1000xm5-wireless-noise-canceling-over-the-ear-headphones-silver/6505728" },
  { group: "sony-xm5-bundle", note: "bundle with stand", trap: "bundle", url: "https://www.bestbuy.com/product/sony-wh-1000xm5-wireless-noise-canceling-headphones-black-wood-headphone-stand/JJG3SJJ7J4/sku/12326508" },
  { group: "kindle-pw", note: "black", url: "https://www.target.com/p/amazon-kindle-paperwhite-2024-black/-/A-91563138" },
  { group: "kindle-pw-sig", note: "Signature Edition", trap: "different model", url: "https://www.target.com/p/amazon-kindle-paperwhite-signature-edition-2024-metallic-black/-/A-93320263" },
  { group: "instant-pot-duo6", note: "walmart", url: "https://www.walmart.com/ip/Instant-Pot-DUO60-6-Qt-7-in-1-Multi-Use-Programmable-Pressure-Cooker/45918917" },
  { group: "instant-pot-nova-refurb", note: "restored Duo Nova", trap: "refurbished + different model", url: "https://www.walmart.com/ip/Instant-Pot-Duo-Nova-6-Quart-7-in-1-One-Touch-Multi-Cooker-Silver-112-0079-0-Refurbished/851820967" },
  { group: "samsung-t7-1tb", note: "titan gray", url: "https://www.bhphotovideo.com/c/product/1559836-REG/samsung_mu_pc1t0t_am_1tb_t7_portable_ssd.html" },
  { group: "samsung-t7-shield-1tb", note: "T7 Shield", trap: "different model", url: "https://www.bhphotovideo.com/c/product/1691588-REG/samsung_mu_pe1t0s_am_1tb_t7_shield_portable.html" },
  { group: "mx-master-3s", note: "Back Market", trap: "refurbished marketplace", url: "https://www.backmarket.com/en-us/p/logitech-mx-master-3s-mouse-wireless/24c32268-7ef8-477f-819f-864825ed84ad" },
  { group: "kitchenaid-artisan", note: "empire red", url: "https://www.kitchenaid.com/countertop-appliances/stand-mixers/tilt-head-stand-mixers/p.artisan-series-5-quart-tilt-head-stand-mixer.KSM150PSER.html" },
  { group: "kitchenaid-artisan", note: "black matte (colour variant)", url: "https://www.kitchenaid.com/countertop-appliances/stand-mixers/tilt-head-stand-mixers/p.artisan-series-5-quart-tilt-head-stand-mixer.KSM150PSBM.html" },
];

let session = "", thread = "", id = 0;
async function rpc(method, params) {
  const res = await fetch("https://mcp.trychannel3.com/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  session = res.headers.get("mcp-session-id") || session;
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: {")) ?? text;
  return JSON.parse(line.replace(/^data: /, "")).result;
}

// REST when CHANNEL3_API_KEY is set (env or .env), otherwise keyless MCP.
let KEY = process.env.CHANNEL3_API_KEY ?? "";
if (!KEY) {
  try {
    const env = await readFile(join(OUT, "..", "..", "..", ".env"), "utf8");
    KEY = (env.match(/^CHANNEL3_API_KEY=(.+)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  } catch {}
}
const MODE = KEY ? "rest" : "mcp";

async function lookup(url) {
  if (MODE === "rest") {
    const res = await fetch("https://api.trychannel3.com/v1/lookup", {
      method: "POST",
      headers: { "x-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const text = await res.text();
    if (!res.ok) return { product: null, raw: { status: res.status, body: text.slice(0, 300) } };
    const data = JSON.parse(text);
    return { product: data.product ?? data, raw: data };
  }
  const r = await rpc("tools/call", { name: "get_products", arguments: { product_ids: [url], ...(thread ? { thread_id: thread } : {}) } });
  const sc = r?.structuredContent ?? {};
  if (sc.thread_id) thread = sc.thread_id;
  return { product: sc.products?.[0] ?? null, raw: sc.products?.[0] ?? r, unresolved: sc.unresolved };
}

if (MODE === "mcp") await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "matchback-spike", version: "0.1" } });
console.log(`URL lookup test, mode=${MODE}\n`);

const rows = [];
for (const c of CASES) {
  const t0 = Date.now();
  const sc = await lookup(c.url);
  const p = sc.product;
  const host = new URL(c.url).hostname.replace(/^www\./, "");
  const own = p?.offers?.find((o) => host.endsWith(o.domain) || o.domain.endsWith(host));
  const row = {
    ...c,
    ms: Date.now() - t0,
    resolved: !!p,
    product_id: p?.id ?? null,
    title: p?.title ?? null,
    offers: p?.offers?.length ?? 0,
    own_offer: own ? { price: own.price?.price, availability: own.availability, condition: own.condition ?? null } : null,
    variants_selected: p?.variants?.selected ?? null,
    unresolved: sc.unresolved ?? null,
    raw: sc.raw,
  };
  rows.push(row);
  console.log(
    `${p ? "OK  " : "MISS"} ${String(row.ms).padStart(5)}ms ${c.group.padEnd(22)} ${(p?.id ?? "-").padEnd(8)} offers=${row.offers} own=${own ? `${own.price?.price} ${own.availability} ${own.condition ?? "?"}` : "-"} | ${(p?.title ?? "").slice(0, 55)}`,
  );
}

await writeFile(join(OUT, `url-lookup-${MODE}.json`), JSON.stringify({ stamp: new Date().toISOString(), rows }, null, 2));

// Same product group should share an id; different groups should not.
const byGroup = {};
for (const r of rows.filter((x) => x.resolved)) (byGroup[r.group] ??= new Set()).add(r.product_id);
const ids = rows.filter((x) => x.resolved).map((x) => [x.group, x.product_id]);
const collisions = ids.filter(([g, i], k) => ids.some(([g2, i2], k2) => k2 !== k && i2 === i && g2 !== g));
console.log(`\nResolved ${rows.filter((r) => r.resolved).length}/${rows.length}`);
console.log("Groups with more than one id (variants split):", Object.entries(byGroup).filter(([, s]) => s.size > 1).map(([g]) => g));
console.log("Different products sharing an id:", collisions.length);
