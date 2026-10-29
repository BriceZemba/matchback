// Channel3 data spike for Matchback.
//
// Question: does Channel3 return, for real branded products, the offer fields a
// price-match verifier needs (price, condition, availability, retailer domain),
// and can a competitor URL be resolved back to the same canonical product?
//
// Usage: node spikes/channel3/spike.mjs
// Uses the REST API when CHANNEL3_API_KEY is set (in env or .env), otherwise the
// keyless MCP free tier. Raw responses go to spikes/channel3/out/.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const ROOT = join(HERE, "..", "..");

const PRODUCTS = [
  "Apple AirPods Pro 2 USB-C",
  "Sony WH-1000XM5 wireless headphones",
  "Nintendo Switch OLED console",
  "Dyson V15 Detect cordless vacuum",
  "KitchenAid Artisan 5 quart tilt-head stand mixer",
  "LEGO Star Wars Millennium Falcon 75257",
  "Instant Pot Duo 7-in-1 6 quart",
  "Bose QuietComfort Ultra Earbuds",
  "Samsung T7 portable SSD 1TB",
  "Logitech MX Master 3S mouse",
  "Garmin Forerunner 265 watch",
  "Yeti Rambler 20 oz tumbler",
  "Ninja AF101 air fryer 4 quart",
  "Kindle Paperwhite 16GB",
  "Apple iPad Air 11-inch M2 128GB Wi-Fi",
  "Nespresso Vertuo Next coffee machine",
  "Hydro Flask 32 oz wide mouth bottle",
  "Vitamix 5200 blender",
  "GoPro HERO12 Black",
  "Theragun Prime massage gun",
];

async function loadKey() {
  if (process.env.CHANNEL3_API_KEY) return process.env.CHANNEL3_API_KEY;
  try {
    const env = await readFile(join(ROOT, ".env"), "utf8");
    const m = env.match(/^CHANNEL3_API_KEY=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

// ---------- REST client ----------

function restClient(key) {
  const base = "https://api.trychannel3.com";
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) return { error: `${res.status} ${text.slice(0, 200)}` };
    return JSON.parse(text);
  };
  return {
    mode: "rest",
    search: async (query) => (await call("POST", "/v1/search", { query, limit: 3 })).products ?? [],
    detail: (id) => call("GET", `/v1/products/${id}`),
    lookup: (url) => call("POST", "/v1/lookup", { url }),
    history: (id) => call("GET", `/v0/price-tracking/history/${id}?days=90`),
  };
}

// ---------- MCP client (keyless free tier) ----------

function mcpClient() {
  const url = "https://mcp.trychannel3.com/";
  let session = "";
  let thread = "";
  let id = 0;
  const rpc = async (method, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    session = res.headers.get("mcp-session-id") || session;
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data: {")) ?? text;
    const msg = JSON.parse(line.replace(/^data: /, ""));
    if (msg.error) throw new Error(JSON.stringify(msg.error));
    return msg.result;
  };
  const tool = async (name, args) => {
    const r = await rpc("tools/call", { name, arguments: thread ? { ...args, thread_id: thread } : args });
    const sc = r.structuredContent ?? {};
    if (sc.thread_id) thread = sc.thread_id;
    return sc;
  };
  return {
    mode: "mcp",
    init: () =>
      rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "matchback-spike", version: "0.1" },
      }),
    search: async (query) => ((await tool("search_products", { query })).products ?? []).slice(0, 3),
    detail: async (pid) => {
      const r = await tool("get_products", { product_ids: [pid] });
      return r.products?.[0] ?? { error: "unresolved", unresolved: r.unresolved };
    },
    lookup: async (u) => {
      const r = await tool("get_products", { product_ids: [u] });
      return r.products?.[0] ? { product: r.products[0] } : { error: "unresolved", unresolved: r.unresolved };
    },
    history: async () => ({ error: "not available on MCP" }),
  };
}

// ---------- analysis ----------

const price = (o) => o?.price?.price ?? o?.price?.amount;

function summarize(query, product, lookup, history) {
  const offers = product?.offers ?? [];
  const has = (f) => offers.filter((o) => o[f] !== undefined && o[f] !== null && o[f] !== "").length;
  const conds = {};
  for (const o of offers) conds[o.condition ?? "missing"] = (conds[o.condition ?? "missing"] ?? 0) + 1;
  const newInStock = offers.filter((o) => o.availability === "InStock" && (o.condition ?? "new") === "new");
  const prices = newInStock.map(price).filter((p) => typeof p === "number").sort((a, b) => a - b);
  const lookedUpId = lookup?.product?.id;
  return {
    query,
    product_id: product?.id ?? null,
    title: product?.title ?? null,
    offers: offers.length,
    domains: new Set(offers.map((o) => o.domain)).size,
    with_price: has("price"),
    with_availability: has("availability"),
    with_condition: has("condition"),
    with_domain: has("domain"),
    conditions: conds,
    out_of_stock: offers.filter((o) => o.availability === "OutOfStock").length,
    new_in_stock_min: prices[0] ?? null,
    new_in_stock_max: prices.at(-1) ?? null,
    spread_pct: prices.length > 1 ? Math.round(((prices.at(-1) - prices[0]) / prices.at(-1)) * 100) : null,
    variants: product?.variants ? product.variants.options?.map((o) => o.name).join("/") || "yes" : "none",
    url_roundtrip: lookup ? (lookup.error ? `error: ${lookup.error}` : lookedUpId === product?.id ? "same id" : `different id ${lookedUpId}`) : "skipped",
    history_points: (history?.history ?? history?.price_history)?.length ?? (history?.error ? `error: ${String(history.error).slice(0, 60)}` : 0),
    history_status: history?.statistics?.current_status ?? null,
    history_min: history?.statistics?.min_price ?? null,
    history_current: history?.statistics?.current_price ?? null,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const key = await loadKey();
  const c = key ? restClient(key) : mcpClient();
  if (c.init) await c.init();
  console.log(`Channel3 spike, mode=${c.mode}, ${PRODUCTS.length} products\n`);

  const rows = [];
  const raw = [];
  for (const q of PRODUCTS) {
    try {
      const hits = await c.search(q);
      const top = hits[0];
      if (!top) {
        rows.push({ query: q, product_id: null, offers: 0 });
        continue;
      }
      const product = await c.detail(top.id);
      // Claim simulation: take a competitor offer URL and resolve it back.
      const competitor = (product.offers ?? []).find((o) => o.url);
      const lookup = competitor ? await c.lookup(competitor.url) : null;
      const history = await c.history(top.id);
      raw.push({ query: q, search_titles: hits.map((h) => h.title), product, lookup, history });
      const row = summarize(q, product, lookup, history);
      rows.push(row);
      console.log(
        `${row.offers.toString().padStart(3)} offers  ${String(row.domains).padStart(2)} shops  cond=${row.with_condition}/${row.offers}  spread=${row.spread_pct ?? "-"}%  hist=${row.history_points}d ${row.history_status ?? "-"}  | ${row.title}`,
      );
    } catch (e) {
      rows.push({ query: q, error: String(e).slice(0, 200) });
      console.log(`ERROR ${q}: ${String(e).slice(0, 200)}`);
    }
  }

  const stamp = new Date().toISOString();
  await writeFile(join(OUT, `raw-${c.mode}.json`), JSON.stringify({ stamp, mode: c.mode, raw }, null, 2));
  await writeFile(join(OUT, `summary-${c.mode}.json`), JSON.stringify({ stamp, mode: c.mode, rows }, null, 2));

  const ok = rows.filter((r) => r.offers > 0);
  const tot = (f) => ok.reduce((s, r) => s + (r[f] ?? 0), 0);
  console.log(`\nResolved ${ok.length}/${rows.length} products, ${tot("offers")} offers total`);
  console.log(`Offers with price ${tot("with_price")}, availability ${tot("with_availability")}, condition ${tot("with_condition")}, domain ${tot("with_domain")}`);
  console.log(`Products with 2+ new in-stock offers: ${ok.filter((r) => r.spread_pct !== null).length}`);
  console.log(`URL round-trip same id: ${ok.filter((r) => r.url_roundtrip === "same id").length}/${ok.length}`);
  console.log(`Saved to ${OUT}`);
}

main();
