import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Evaluation harness. Scores three systems on the same labelled claims and the same Channel3 answers:
//   matchback — the verifier as shipped (rules + AI identity when Channel3 ids differ)
//   id_only   — the same rules, identity from Channel3 ids alone (no AI)
//   naive     — "approve when that retailer's price is lower", the obvious price-match bot
// Channel3 answers and AI answers are cached in eval/eval-cache.db, so a re-run with the frozen cache
// reproduces the numbers exactly. Run:
//   EVAL=1 EVAL_SPLIT=dev npx vitest run --config eval/vitest.config.ts
//   EVAL=1 EVAL_SPLIT=heldout npx vitest run --config eval/vitest.config.ts

for (const line of (() => { try { return readFileSync(".env", "utf8"); } catch { return ""; } })().split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim();
}
process.env.MATCHBACK_DB = "eval/eval-cache.db";

type Case = { id: string; product: string; split: "dev" | "heldout"; url: string; legit: boolean; kind: string; why: string };
type Product = { title: string; productId?: string; refUrl?: string; paidCents: number };
type Spec = { products: Record<string, Product>; cases: Case[] };
type SystemName = "matchback" | "id_only" | "naive";
type Row = {
  case: Case;
  paidCents: number;
  competitorCents: number | null;
  condition: string | null;
  conditionSource: string | null;
  availability: string | null;
  competitorId: string | null;
  relation: string | null;
  lookupError: string | null;
  results: Record<SystemName, { decision: string; refundCents: number; notPassed: string[] }>;
};

const FACT_CHECKS = new Set(["stock", "cheaper", "floor", "window"]);

/** correct | manual (sent to a person) | unsafe (paid a claim that should not be paid) | missed (refused a legit claim for a non-factual reason). */
function grade(c: Case, r: { decision: string; notPassed: string[] }): "correct" | "manual" | "unsafe" | "missed" {
  if (r.decision === "needs_review") return "manual";
  if (!c.legit) return r.decision === "approved" ? "unsafe" : "correct";
  if (r.decision === "approved") return "correct";
  const failed = r.notPassed.filter((n) => n.includes(": fail")).map((n) => n.split(":")[0]!);
  return failed.length > 0 && failed.every((id) => FACT_CHECKS.has(id)) ? "correct" : "missed";
}

describe.skipIf(process.env.EVAL !== "1")("evaluation", () => {
  it("scores matchback, id_only and naive", { timeout: 3_600_000 }, async () => {
    const split = (process.env.EVAL_SPLIT ?? "dev") as "dev" | "heldout" | "all";
    const { getDb } = await import("@/lib/db");
    const { createChannel3Client, domainOf, offerForDomain } = await import("@/lib/channel3");
    const { cachedChannel3 } = await import("@/lib/channel3-cache");
    const { evaluateClaim } = await import("@/lib/verifier/run");
    const { settingsFromEnv } = await import("@/lib/verifier/policy");
    const { providersFromEnv } = await import("@/lib/llm");

    const db = getDb();
    db.exec("CREATE TABLE IF NOT EXISTS llm_cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, status INTEGER NOT NULL)");
    const mode = (process.env.EVAL_CACHE as "frozen" | "ttl" | "off" | undefined) ?? "frozen";
    const channel3 = cachedChannel3(createChannel3Client(), db, { mode, cacheErrors: true });

    // Cache AI answers by request body, so the same prompt always gets the same recorded answer.
    const llmFetch: typeof fetch = async (input, init) => {
      const key = createHash("sha256").update(String(init?.body ?? "")).digest("hex");
      const hit = db.prepare("SELECT body, status FROM llm_cache WHERE key = ?").get(key) as { body: string; status: number } | undefined;
      if (hit) return new Response(hit.body, { status: hit.status });
      // Groq's free tier allows 8,000 tokens a minute (about 5 identity checks): wait for the reset it
      // reports and retry, so a rate limit never turns into "AI unavailable" inside the evaluation.
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(input, init);
        const body = await res.text();
        if (res.status === 429 && attempt < 10) {
          const reset = Number.parseFloat(res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-reset-tokens") ?? "15");
          await new Promise((r) => setTimeout(r, Math.min(Math.max(Number.isFinite(reset) ? reset : 15, 2), 60) * 1000 + 500));
          continue;
        }
        if (res.ok) db.prepare("INSERT OR REPLACE INTO llm_cache (key, body, status) VALUES (?, ?, ?)").run(key, body, res.status);
        return new Response(body, { status: res.status });
      }
    };
    // One model for the whole evaluation: Groq only, no fallback to a different model mid-run.
    const providers = providersFromEnv().filter((p) => p.name === "groq");
    if (providers.length === 0) throw new Error("GROQ_API_KEY is required for the evaluation");

    const spec = JSON.parse(readFileSync("eval/cases.json", "utf8")) as Spec;
    const settings = settingsFromEnv({} as NodeJS.ProcessEnv); // shipped defaults, not local overrides
    const now = () => new Date("2026-10-29T12:00:00Z");
    const capturedAt = "2026-10-29T00:00:00Z";

    const purchasedIds: Record<string, string> = {};
    for (const [key, p] of Object.entries(spec.products)) purchasedIds[key] = p.productId ?? (await channel3.lookup(p.refUrl!)).id;

    const cases = spec.cases.filter((c) => split === "all" || c.split === split);
    const rows: Row[] = [];
    for (const c of cases) {
      const product = spec.products[c.product]!;
      const input = { purchasedProductId: purchasedIds[c.product]!, purchasedTitle: product.title, paidCents: product.paidCents, currency: "USD", capturedAt, competitorUrl: c.url };
      const base = { channel3, settings, now, llmFetch, providers };
      const mb = await evaluateClaim(input, { ...base, identityMode: "ai" });
      const io = await evaluateClaim(input, { ...base, identityMode: "id_only" });
      const notPassed = (ev: typeof mb) => ev.decision.checks.filter((k) => k.outcome !== "pass").map((k) => `${k.id}: ${k.outcome}`);

      // Naive bot: same Channel3 lookup, approve when that retailer's offer is at least $1 cheaper.
      let naive = { decision: "needs_review", refundCents: 0, notPassed: ["lookup: review"] };
      try {
        const offer = offerForDomain(await channel3.lookup(c.url), domainOf(c.url));
        const cents = offer ? Math.round(offer.price.price * 100) : null;
        naive = cents !== null && product.paidCents - cents >= 100
          ? { decision: "approved", refundCents: product.paidCents - cents, notPassed: [] }
          : { decision: "refused", refundCents: 0, notPassed: ["cheaper: fail"] };
      } catch {}

      rows.push({
        case: c,
        paidCents: product.paidCents,
        competitorCents: mb.decision.competitorCents,
        condition: mb.competitor?.condition ?? null,
        conditionSource: mb.competitor?.conditionSource ?? null,
        availability: mb.competitor?.availability ?? null,
        competitorId: mb.competitor?.productId ?? null,
        relation: mb.identity?.relation ?? null,
        lookupError: mb.lookupError ?? null,
        results: {
          matchback: { decision: mb.decision.status, refundCents: mb.decision.refundCents, notPassed: notPassed(mb) },
          id_only: { decision: io.decision.status, refundCents: io.decision.refundCents, notPassed: notPassed(io) },
          naive,
        },
      });
      console.log(`${c.id.padEnd(8)} legit=${String(c.legit).padEnd(5)} mb=${mb.decision.status.padEnd(12)} id=${io.decision.status.padEnd(12)} naive=${naive.decision}`);
    }

    const systems: SystemName[] = ["matchback", "id_only", "naive"];
    const summary = Object.fromEntries(systems.map((s) => {
      const graded = rows.map((r) => ({ r, g: grade(r.case, r.results[s]) }));
      const count = (g: string) => graded.filter((x) => x.g === g).length;
      const unsafe = graded.filter((x) => x.g === "unsafe");
      const legit = rows.filter((r) => r.case.legit);
      return [s, {
        cases: rows.length,
        correct: count("correct"),
        manual: count("manual"),
        unsafe: unsafe.length,
        missed: count("missed"),
        unsafeDollars: unsafe.reduce((t, x) => t + x.r.results[s].refundCents, 0) / 100,
        legitAutoPaid: legit.filter((r) => r.results[s].decision === "approved").length,
        legitTotal: legit.length,
        trapsTotal: rows.length - legit.length,
      }];
    }));

    writeFileSync(`eval/results-${split}.json`, JSON.stringify({ ranAt: new Date().toISOString(), split, cache: mode, summary, rows }, null, 2));
    console.table(summary);
    expect(rows.length).toBe(cases.length);
  });
});
