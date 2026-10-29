import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createChannel3Client } from "@/lib/channel3";
import { settingsFromEnv } from "@/lib/verifier/policy";
import { evaluateClaim } from "@/lib/verifier/run";

// Live: repeat the B&H Samsung T7 claim against real Channel3 (no cache) and record which source
// supplied the offer's condition each time. Skipped unless LIVE=1. Run: LIVE=1 npx vitest run test/live
for (const line of (() => { try { return readFileSync(".env", "utf8"); } catch { return ""; } })().split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim();
}

const URL_BH = "https://www.bhphotovideo.com/c/product/1559836-REG/samsung_mu_pc1t0t_am_1tb_t7_portable_ssd.html";
const RUNS = 5;

describe.skipIf(process.env.LIVE !== "1")("live condition second source", () => {
  it(`B&H T7 claim, ${RUNS} runs`, { timeout: 300_000 }, async () => {
    const channel3 = createChannel3Client();
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const ev = await evaluateClaim(
        { purchasedProductId: "e2dXeQi", purchasedTitle: "Samsung T7 Portable SSD 1TB", paidCents: 27499, currency: "USD", capturedAt: new Date().toISOString(), competitorUrl: URL_BH },
        { channel3, settings: settingsFromEnv(), identityMode: "ai", now: () => new Date() },
      );
      runs.push({ run: i + 1, decision: ev.decision.status, condition: ev.competitor?.condition ?? null, conditionSource: ev.competitor?.conditionSource ?? null, refundCents: ev.decision.refundCents });
    }
    mkdirSync("evidence", { recursive: true });
    writeFileSync("evidence/condition-live.json", JSON.stringify({ ranAt: new Date().toISOString(), url: URL_BH, runs }, null, 2));
    console.table(runs);
    expect(runs).toHaveLength(RUNS);
  });
});
