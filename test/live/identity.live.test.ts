import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createChannel3Client } from "@/lib/channel3";
import { settingsFromEnv } from "@/lib/verifier/policy";
import { evaluateClaim } from "@/lib/verifier/run";

// Live check against real Channel3 and the real LLM providers. Skipped unless LIVE=1.
// Run: LIVE=1 npx vitest run test/live
for (const line of (() => { try { return readFileSync(".env", "utf8"); } catch { return ""; } })().split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim();
}

// Purchased product = a pinned catalog id from lib/catalog.ts; competitor URLs are real retailer pages
// found on 2026-10-28. `expect` is the relation a careful person would give.
const CASES = [
  { name: "T7 vs T7 Shield", purchased: "e2dXeQi", paid: 27499, url: "https://www.bhphotovideo.com/c/product/1691588-REG/samsung_mu_pe1t0s_am_1tb_t7_shield_portable.html", expect: "different_model" },
  { name: "Kindle Paperwhite vs Signature Edition", purchased: "cTyUOkU", paid: 19999, url: "https://www.target.com/p/amazon-kindle-paperwhite-signature-edition-2024-metallic-black/-/A-93320263", expect: "different_model" },
  { name: "KitchenAid Artisan red vs black matte", purchased: "muLXXMd", paid: 44999, url: "https://www.kitchenaid.com/countertop-appliances/stand-mixers/tilt-head-stand-mixers/p.artisan-series-5-quart-tilt-head-stand-mixer.KSM150PSBM.html", expect: "same_product_other_color" },
];

describe.skipIf(process.env.LIVE !== "1")("live identity (Channel3 + LLM)", () => {
  it("classifies the id-split cases", { timeout: 300_000 }, async () => {
    const channel3 = createChannel3Client();
    const results = [];
    for (const c of CASES) {
      const t0 = Date.now();
      const ev = await evaluateClaim(
        { purchasedProductId: c.purchased, purchasedTitle: c.name, paidCents: c.paid, currency: "USD", capturedAt: new Date().toISOString(), competitorUrl: c.url },
        { channel3, settings: settingsFromEnv(), identityMode: "ai", now: () => new Date() },
      );
      results.push({
        case: c.name,
        expected: c.expect,
        got: ev.identity?.relation ?? null,
        method: ev.identity?.method ?? null,
        provider: ev.identity?.provider ?? null,
        evidence: ev.identity?.evidence ?? [],
        competitorId: ev.competitor?.productId ?? null,
        decision: ev.decision.status,
        notPassed: ev.decision.checks.filter((k) => k.outcome !== "pass").map((k) => `${k.id}: ${k.outcome} — ${k.detail}`),
        lookupError: ev.lookupError ?? null,
        ms: Date.now() - t0,
      });
    }
    mkdirSync("evidence", { recursive: true });
    writeFileSync("evidence/identity-live.json", JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
    console.table(results.map(({ evidence, ...r }) => r));
    expect(results.every((r) => r.got !== null)).toBe(true);
  });
});
