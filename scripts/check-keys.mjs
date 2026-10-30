// Checks every credential in .env against its service and prints only pass/fail,
// never the values. Usage: node scripts/check-keys.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadEnv() {
  const env = { ...process.env };
  const text = await readFile(join(ROOT, ".env"), "utf8");
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = await loadEnv();
const results = [];

async function check(name, keys, fn) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) return results.push({ name, ok: false, detail: `not set: ${missing.join(", ")}`, ms: 0 });
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message ?? e).slice(0, 220), ms: Date.now() - t0 });
  }
}

async function json(res) {
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text);
}

// A tiny tool-calling request: the agent depends on tool calls, so test that, not just chat.
async function llmToolCall(baseUrl, key, model) {
  const res = await fetch(baseUrl.replace(/\/?$/, "/") + "chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Look up the price of product abc123 using the tool." }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_price",
            description: "Get the current price of a product",
            parameters: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] },
          },
        },
      ],
      tool_choice: "auto",
      max_tokens: 200,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await json(res);
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error(`model answered without a tool call: ${JSON.stringify(data.choices?.[0]?.message).slice(0, 120)}`);
  return `model ${data.model ?? model}, tool call ${call.function.name}(${call.function.arguments})`;
}

await check("PayPal sandbox OAuth", ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], async () => {
  const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const data = await json(
    await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }),
  );
  const scopes = data.scope?.split(" ") ?? [];
  const has = (s) => scopes.some((x) => x.includes(s));
  return `token ok (expires in ${data.expires_in}s); scopes: orders/payments ${has("payments") ? "yes" : "no"}, disputes ${has("disputes") ? "yes" : "no"}, reporting ${has("reporting") ? "yes" : "no"}`;
});

await check("Channel3 REST", ["CHANNEL3_API_KEY"], async () => {
  const data = await json(
    await fetch("https://api.trychannel3.com/v1/search", {
      method: "POST",
      headers: { "x-api-key": env.CHANNEL3_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Samsung T7 portable SSD 1TB", limit: 1 }),
    }),
  );
  return `search ok, ${data.products?.length ?? 0} product, first offer fields: ${Object.keys(data.products?.[0]?.offers?.[0] ?? {}).join(",")}`;
});

await check("Gemini LLM", ["GEMINI_API_KEY"], () => llmToolCall(env.GEMINI_BASE_URL, env.GEMINI_API_KEY, env.GEMINI_MODEL));
await check("Groq LLM", ["GROQ_API_KEY"], () => llmToolCall(env.GROQ_BASE_URL, env.GROQ_API_KEY, env.GROQ_MODEL));

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(22)} ${String(r.ms).padStart(5)}ms  ${r.detail}`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
