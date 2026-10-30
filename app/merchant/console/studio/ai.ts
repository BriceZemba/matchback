// The console's AI, on Groq through the server proxy (app/api/ai/responses). Matchback's own agent
// fronts every conversation: it reads the review queue, explains a claim from its evidence, queries
// the dashboard's data with Studio's tools, and hands chart and layout work to AG Studio's built-in
// widget and data agents. It proposes decisions; only a person's click in the Review queue moves money.
//
// Why ours leads rather than Studio's lead agent: on Groq's free tier (about 8,000 tokens a minute for
// gpt-oss) the built-in lead's instructions and five-way delegation used the whole budget in one turn,
// and the model filled the delegation tool's union schema wrongly. A short lead with two delegation
// targets fits and calls tools reliably.

import { createAiHarness, directLlmRunner, type AgAiAgentContext, type AgAiHarnessSetup, type AgAiParamsBuilder, type AgAiPromptStarter, type AgAiTool, type AgStudioApi } from "ag-studio";
import type { ClaimRecord, Summary } from "@/lib/merchant";
import { openaiAdapter } from "./openai-adapter";

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "What's waiting for me?", prompt: "Which claims are waiting for a person, and what do you suggest for each?" },
  { label: "Why claims are refused", prompt: "Why are claims being refused or sent to a person? Show the main reasons." },
  { label: "Money kept", prompt: "How much have refunds cost compared with the sales we kept?" },
  { label: "Chart claims per store", prompt: "Add a chart of claims per competitor store, split by outcome." },
];

const LEAD_INSTRUCTIONS = `You are Matchback's assistant, working for the store that runs a price-match guarantee, inside its AG Studio dashboard.
How the guarantee works: a shopper who paid with PayPal sends a cheaper offer for the same product (a link, a screenshot, or one the price watch found). Matchback checks seven rules: claim window (14 days), known store (a listed competitor or the brand's own store; resale marketplaces refused, unknown shops sent to a person), sold new, in stock, at least $1 cheaper, plausible price (under 60% of the price paid goes to a person), same product (an AI verdict, overruled by fixed rules on editions, generations and model years). If every check passes, PayPal refunds the difference on the original payment. If a check fails, the claim is refused. If something cannot be proven, the claim goes to a person: those are the claims you help with.
Your tools: review_queue lists claims waiting for a person; explain_claim gives one claim's evidence; claims_summary gives the totals; propose_decision records your suggestion and opens the Review queue page. For other questions about the dashboard's data, delegate to the "data" agent; to add or change a chart or widget, delegate to the "widget" agent, each with a precise request.
Rules:
- Base every statement on tool results. Quote amounts in USD with two decimals.
- For a claim waiting for review, say which check needed a person and what evidence would settle it, then propose approve (with the amount: price paid minus the competitor's price, never more than half the price paid) or refuse (with a short note the shopper will read).
- You cannot approve, refuse or refund anything yourself, and must never say a refund was made. Tell the user to confirm in the Review queue with Approve or Refuse.
- Be brief: a few lines per claim.`;

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(res.status === 401 ? "Signed out of the store desk." : `Request failed (${res.status}).`);
  return (await res.json()) as T;
}

const usd = (n: number | null | undefined) => (n === null || n === undefined ? "unknown" : `$${n.toFixed(2)}`);

type Evidence = {
  status: string;
  evidence: null | {
    decision: { status: string; competitorCents: number | null; checks: { label: string; outcome: string; detail: string }[] };
    identity: { relation: string; evidence: string[] } | null;
    competitor: { title: string; domain: string; condition: string | null; availability?: string } | null;
    purchased: { title: string };
    image?: { extraction: { product: string; store: string | null; priceCents: number | null } | null; reason?: string };
    review?: { outcome: string; note: string };
  };
};

function claimsTools(api: AgStudioApi): AgAiTool[] {
  return [
    api.defineAiTool({
      name: "review_queue",
      description: "List the claims waiting for a person, newest first: product, competitor store and price, price paid, and the check that needed a person.",
      params: (s) => s.object({}),
      execute: async (_args, ctx) => {
        const rows = await getJson<ClaimRecord[]>("/api/merchant/claims?status=needs_review&limit=20", ctx.signal);
        if (rows.length === 0) return ctx.success("No claim is waiting for a person.");
        const lines = rows.map((r) => `- ${r.id} · ${r.product} · paid ${usd(r.paid)} · offer ${usd(r.offerPrice)} at ${r.store ?? "unknown store"} · needs a person: ${r.reason} · filed ${r.createdAt.slice(0, 16).replace("T", " ")} UTC`);
        return ctx.success(`${rows.length} claim(s) waiting:\n${lines.join("\n")}`, { rows });
      },
    }),
    api.defineAiTool({
      name: "explain_claim",
      description: "Get one claim's evidence: every check with its outcome and detail, the AI identity verdict, the competitor listing, and for screenshots what was read from the image.",
      params: (s) => s.object({ claimId: s.string({ description: "The claim id, as listed by review_queue." }) }),
      execute: async (args, ctx) => {
        const claim = await getJson<Evidence>(`/api/claims/${encodeURIComponent(args.claimId)}`, ctx.signal).catch(() => null);
        if (!claim?.evidence) return ctx.error("No evidence found for that claim id.");
        const ev = claim.evidence;
        const lines = [
          `Status: ${claim.status}. Purchased: ${ev.purchased.title}.`,
          ev.competitor ? `Competitor listing: ${ev.competitor.title} at ${ev.competitor.domain}, condition ${ev.competitor.condition ?? "not stated"}, ${ev.competitor.availability ?? "stock unknown"}, price ${ev.decision.competitorCents === null ? "unknown" : usd(ev.decision.competitorCents / 100)}.` : "No competitor listing could be read.",
          ev.image?.extraction ? `Screenshot read: ${ev.image.extraction.product} at ${ev.image.extraction.store ?? "unknown store"} for ${ev.image.extraction.priceCents === null ? "unknown price" : usd(ev.image.extraction.priceCents / 100)}.` : "",
          ev.identity ? `AI identity verdict: ${ev.identity.relation.replaceAll("_", " ")}. ${ev.identity.evidence.join(" ")}` : "",
          "Checks:",
          ...ev.decision.checks.map((c) => `- ${c.label}: ${c.outcome}. ${c.detail}`),
          ev.review ? `Already decided by a person: ${ev.review.outcome}. ${ev.review.note}` : "",
        ].filter(Boolean);
        return ctx.success(lines.join("\n"));
      },
    }),
    api.defineAiTool({
      name: "claims_summary",
      description: "Totals for the guarantee: claims by status, share decided automatically, money refunded, sales kept, refused claims, most-claimed stores and products.",
      params: (s) => s.object({}),
      execute: async (_args, ctx) => {
        const s = await getJson<Summary>("/api/merchant/summary", ctx.signal);
        return ctx.success(
          [
            `Claims: ${s.claims} (${Object.entries(s.byStatus).map(([k, v]) => `${k} ${v}`).join(", ")}).`,
            `Decided automatically: ${s.automaticShare ?? "n/a"}%. Waiting for a person: ${s.waitingForReview}.`,
            `Refunded: ${usd(s.refundedTotal)}. Sales kept: ${usd(s.salesKept)}.`,
            `Stores: ${s.stores.map((x) => `${x.store} ${x.claims} (${x.refused} refused, ${usd(x.refunded)} refunded)`).join("; ")}.`,
          ].join("\n"),
          s,
        );
      },
    }),
    api.defineAiTool({
      name: "propose_decision",
      description: "Record a suggested decision for a claim waiting for a person and open the Review queue page, where a person confirms it. This does not approve, refuse or refund anything.",
      params: (s) =>
        s.object({
          claimId: s.string({ description: "The claim id." }),
          decision: s.enum(["approve", "refuse"] as const, { description: "Approve with a refund amount, or refuse." }),
          amount: s.number({ description: "Refund in USD for an approval: price paid minus the competitor's price. Use 0 for a refusal." }),
          note: s.string({ description: "A short note to the shopper explaining the decision." }),
        }),
      execute: async (args, ctx) => {
        api.setState({ ...api.getState(), selectedPageId: "review" });
        const what = args.decision === "approve" ? `approve with a refund of ${usd(args.amount)}` : "refuse";
        return ctx.success(`Suggestion recorded for claim ${args.claimId}: ${what}. Note: "${args.note}". The Review queue page is open; a person must press ${args.decision === "approve" ? "Approve & refund" : "Refuse"} there to make it happen.`, args);
      },
    }),
  ];
}

export function buildAi(models: { id: string; label: string }[]): AgAiHarnessSetup {
  const adapter = openaiAdapter({ endpoint: "/api/ai", model: models[0]!.id });
  return ({ api }) =>
    createAiHarness(api, ({ builtIn }) => ({
      agents: [
        directLlmRunner({
          id: "matchback",
          name: "Matchback assistant",
          adapter,
          description: "Matchback's assistant for the price-match guarantee: claims, decisions and the numbers.",
          schema: (s: AgAiParamsBuilder) => s.undefined(),
          instructions: () => LEAD_INSTRUCTIONS,
          // Studio's query tools carry large schemas; data questions go to its data agent instead.
          tools: (ctx: AgAiAgentContext) => [...claimsTools(api), ctx.tools.delegateTo(["widget", "data"])],
          maxTurns: 10,
        } as never),
        // AG Studio's own agents, as delegation targets for charts, layout and data modelling.
        directLlmRunner({ ...builtIn.widget, adapter } as never),
        directLlmRunner({ ...builtIn.data, adapter } as never),
      ],
      primary: "matchback",
      models,
      promptStarters: PROMPT_STARTERS,
    }));
}
