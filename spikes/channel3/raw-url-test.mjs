// Claim-path test: a shopper pastes a plain retailer URL, not a Channel3 buy link.
// Resolve buy links from the spike to the retailer URL (redirect Location only, no
// page fetch), strip tracking params, then ask Channel3 to resolve that URL and
// compare the canonical product id.
//
// Usage: node spikes/channel3/raw-url-test.mjs   (after spike.mjs)

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const { raw } = JSON.parse(await readFile(join(OUT, "raw-mcp.json"), "utf8"));

async function resolveRetailerUrl(buyUrl) {
  let url = buyUrl;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, { redirect: "manual" });
    const loc = res.headers.get("location");
    if (!loc) return url;
    url = new URL(loc, url).toString();
    const host = new URL(url).hostname;
    if (!/trychannel3|impact|awin|cj\.com|linksynergy|sjv\.io|anrdoezrs|dpbolvw|jdoqocy|kqzyfj|tkqlhce|pxf\.io|go\.skimresources|click\.linksynergy|avantlink|shareasale|partnerize|prf\.hn/.test(host)) {
      return url;
    }
  }
  return url;
}

function clean(u) {
  const x = new URL(u);
  for (const k of [...x.searchParams.keys()]) {
    if (/^(utm_|irclickid|irgwc|clickid|ranMID|ranEAID|ranSiteID|aid|cjevent|ref|affid|sharedid|irpid|subid)/i.test(k)) x.searchParams.delete(k);
  }
  return x.toString();
}

// Minimal MCP client (same protocol as spike.mjs).
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
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "matchback-spike", version: "0.1" } });

// One offer per product, preferring big retailers a shopper would cite.
const picks = [];
for (const r of raw) {
  const offers = r.product.offers ?? [];
  const o = offers.find((x) => /bestbuy|target|walmart|macys|kohls/.test(x.domain)) ?? offers[0];
  if (o) picks.push({ product_id: r.product.id, title: r.product.title, domain: o.domain, buy: o.url, price: o.price?.price });
}

const results = [];
for (const p of picks) {
  let retailer = null, lookup = null, err = null;
  try {
    retailer = clean(await resolveRetailerUrl(p.buy));
    if (new URL(retailer).hostname.includes("trychannel3")) throw new Error("did not leave channel3 redirect");
    const r = await rpc("tools/call", { name: "get_products", arguments: { product_ids: [retailer], ...(thread ? { thread_id: thread } : {}) } });
    const sc = r?.structuredContent ?? {};
    if (sc.thread_id) thread = sc.thread_id;
    lookup = sc.products?.[0] ?? null;
    if (!lookup) err = `unresolved ${JSON.stringify(sc.unresolved ?? r?.content?.[0]?.text ?? "").slice(0, 120)}`;
  } catch (e) {
    err = String(e).slice(0, 160);
  }
  const offer = lookup?.offers?.find((o) => o.domain === p.domain);
  const row = {
    product_id: p.product_id,
    title: p.title,
    domain: p.domain,
    retailer_url: retailer,
    looked_up_id: lookup?.id ?? null,
    same_id: lookup ? lookup.id === p.product_id : false,
    looked_up_title: lookup?.title ?? null,
    offer_price_then: p.price,
    offer_price_now: offer?.price?.price ?? null,
    error: err,
  };
  results.push(row);
  console.log(`${row.same_id ? "SAME " : lookup ? "DIFF " : "FAIL "} ${p.domain.padEnd(18)} ${p.title.slice(0, 45).padEnd(45)} ${err ?? (row.same_id ? "" : "-> " + row.looked_up_title)}`);
}

await writeFile(join(OUT, "raw-url-test.json"), JSON.stringify({ stamp: new Date().toISOString(), results }, null, 2));
const ok = results.filter((r) => r.looked_up_id);
console.log(`\nResolved ${ok.length}/${results.length}; same canonical id ${results.filter((r) => r.same_id).length}/${results.length}`);
