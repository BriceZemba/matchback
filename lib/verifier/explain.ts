import { callTool, LlmUnavailableError, type LlmProvider } from "@/lib/llm";
import type { Decision } from "./policy";
import type { IdentityVerdict } from "./identity";

// A plain-language explanation of a decision, written by the AI from the checks that were run. The
// decision is already made when this runs; the explanation never changes it. A guard rejects any text
// that mentions an amount not in the data or contradicts the decision, and a template takes over.

export type Explanation = { text: string; source: "ai" | "template"; provider?: string };

export type ExplainInput = {
  decision: Decision;
  identity: IdentityVerdict | null;
  purchasedTitle: string;
  paidCents: number;
  competitor: { title: string; domain: string; condition: string | null; availability?: string } | null;
};

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const SYSTEM = [
  "You write a short explanation to a shopper about their price-match claim. The decision is already made; you only explain it.",
  "Use ONLY the facts provided. Do not invent prices, stores, products, conditions or reasons.",
  "Two or three sentences, under 70 words, warm and plain. Start directly with the decision: no greeting, no thanks, no sign-off. No internal terms (no 'Channel3', 'catalog id', 'policy check', 'floor').",
  "Approved: say the difference is being refunded to their PayPal account and give the refund amount.",
  "Refused: say clearly it does not qualify and why, using the failed checks; suggest what would qualify if obvious (for example the same model sold new).",
  "Needs review: say a person at the store will look at it and why it could not be confirmed automatically. Do not promise a refund.",
].join("\n");

const TOOL = {
  name: "write_explanation",
  description: "Return the explanation for the shopper.",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};

function facts(input: ExplainInput): string {
  const d = input.decision;
  const lines = [
    `decision: ${d.status}`,
    `purchased product: ${input.purchasedTitle}`,
    `price paid: ${usd(input.paidCents)}`,
    input.competitor ? `competitor listing: "${input.competitor.title}" at ${input.competitor.domain}` : "competitor listing: could not be read",
    d.competitorCents !== null ? `competitor price: ${usd(d.competitorCents)}` : "",
    d.status === "approved" ? `refund amount: ${usd(d.refundCents)}` : "",
    input.identity ? `same product?: ${input.identity.relation.replaceAll("_", " ")}${input.identity.evidence.length ? ` (${input.identity.evidence.join("; ")})` : ""}` : "",
    "checks:",
    ...d.checks.map((c) => `- ${c.label}: ${c.outcome} — ${c.detail}`),
  ];
  return lines.filter(Boolean).join("\n");
}

/** Amounts the text may mention: the price paid, the competitor price and the refund. */
function allowedAmounts(input: ExplainInput): Set<string> {
  const s = new Set([usd(input.paidCents), usd(input.decision.refundCents)]);
  if (input.decision.competitorCents !== null) s.add(usd(input.decision.competitorCents));
  return s;
}

/** Why a generated text is unusable, or null when it passes. */
export function rejectExplanation(text: string, input: ExplainInput): string | null {
  const t = text.trim();
  if (t.length < 20 || t.length > 600) return "length";
  const allowed = allowedAmounts(input);
  for (const m of t.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? []) {
    const cents = Math.round(Number(m.replace(/[$,\s]/g, "")) * 100);
    if (!allowed.has(usd(cents))) return `amount ${m} is not in the data`;
  }
  const status = input.decision.status;
  if (status === "approved" && !t.includes(usd(input.decision.refundCents))) return "approved text must state the refund amount";
  if (status !== "approved" && /\b(has been|have been|was|is being|will be) refunded\b|\byour refund\b/i.test(t)) return "promises a refund the decision did not grant";
  return null;
}

export function templateExplanation(input: ExplainInput): string {
  const d = input.decision;
  const where = input.competitor?.domain ?? "the other store";
  if (d.status === "approved") {
    return `You paid ${usd(input.paidCents)}, and ${where} sells the same product new and in stock for ${usd(d.competitorCents ?? 0)}. The ${usd(d.refundCents)} difference is being refunded to your PayPal account.`;
  }
  const fail = d.checks.find((c) => c.outcome === "fail");
  const review = d.checks.find((c) => c.outcome === "review");
  if (d.status === "refused") return `This offer doesn't qualify for a price match. ${fail?.detail ?? ""}`.trim();
  return `A person at the store will look at this claim, because it couldn't be confirmed automatically: ${review?.detail ?? "some details were missing."}`;
}

export async function explainDecision(input: ExplainInput, opts: { providers?: LlmProvider[]; fetch?: typeof fetch } = {}): Promise<Explanation> {
  try {
    const { args, provider } = await callTool<{ text?: string }>(SYSTEM, facts(input), TOOL, {
      ...(opts.providers ? { providers: opts.providers } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    const text = (args.text ?? "").trim();
    if (!rejectExplanation(text, input)) return { text, source: "ai", provider };
  } catch (err) {
    if (!(err instanceof LlmUnavailableError)) throw err;
  }
  return { text: templateExplanation(input), source: "template" };
}
