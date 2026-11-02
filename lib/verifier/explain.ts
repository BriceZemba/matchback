import { callTool, LlmUnavailableError, type LlmProvider } from "@/lib/llm";
import { dict, type Locale } from "@/lib/i18n";
import type { Decision } from "./policy";
import type { IdentityVerdict } from "./identity";

// A plain-language explanation of a decision, written by the AI from the checks that were run. The
// decision is already made when this runs; the explanation never changes it. A guard rejects any text
// that mentions an amount not in the data or contradicts the decision, and a template takes over.
// The shopper's language is honoured; the facts stay in English and the model translates.

export type Explanation = { text: string; source: "ai" | "template"; provider?: string };

export type ExplainInput = {
  decision: Decision;
  identity: IdentityVerdict | null;
  purchasedTitle: string;
  paidCents: number;
  competitor: { title: string; domain: string; condition: string | null; availability?: string } | null;
  locale?: Locale;
};

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const LANGUAGE: Record<Locale, string> = { en: "English", fr: "French", es: "Spanish" };

function system(locale: Locale): string {
  return [
    "You write a short explanation to a shopper about their price-match claim. The decision is already made; you only explain it.",
    "Use ONLY the facts provided. Do not invent prices, stores, products, conditions or reasons.",
    "Two or three sentences, under 70 words, warm and plain. Start directly with the decision: no greeting, no thanks, no sign-off. No internal terms (no 'Channel3', 'catalog id', 'policy check', 'floor').",
    "Approved: say the difference is being refunded to their PayPal account and give the refund amount.",
    "Refused: say clearly it does not qualify and why, using the failed checks; suggest what would qualify if obvious (for example the same model sold new).",
    "Needs review: say a person at the store will look at it and why it could not be confirmed automatically. Do not promise a refund.",
    `Write in ${LANGUAGE[locale]}. Amounts are US dollars: write each one exactly as given, like $44.98, never in another currency.`,
  ].join("\n");
}

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

/** Dollar amounts in a text, in cents: "$44.98", "44,98 $", "44.98 USD", "US$ 1,234.50". */
export function amountsIn(text: string): number[] {
  const num = String.raw`\d[\d.,\s  ]*\d|\d`;
  const re = new RegExp(String.raw`(?:US\s?)?\$\s?(${num})|(${num})\s?(?:US\s?\$|\$|USD)`, "g");
  const out: number[] = [];
  for (const m of text.matchAll(re)) {
    const raw = (m[1] ?? m[2]!).replace(/[\s  ]/g, "");
    const dec = raw.match(/[.,](\d{1,2})$/);
    const whole = (dec ? raw.slice(0, -dec[0].length) : raw).replace(/[.,]/g, "");
    out.push(Number(whole) * 100 + (dec ? Number(dec[1]!.padEnd(2, "0")) : 0));
  }
  return out;
}

const REFUND_PROMISE: Record<Locale, RegExp> = {
  en: /\b(has been|have been|was|is being|will be) refunded\b|\byour refund\b/i,
  fr: /\b(est|sera|a été|ont été|sont|seront) (en cours de )?rembours|\bvotre remboursement\b/i,
  es: /\b(será|serán|ha sido|han sido|fue|está siendo|se está|se le) reembols|\b(su|tu) reembolso\b/i,
};

/** Why a generated text is unusable, or null when it passes. */
export function rejectExplanation(text: string, input: ExplainInput): string | null {
  const t = text.trim();
  const locale = input.locale ?? "en";
  if (t.length < 20 || t.length > 600) return "length";
  if (/€|EUR\b/.test(t)) return "wrong currency";
  const allowed = new Set([input.paidCents, input.decision.refundCents, ...(input.decision.competitorCents !== null ? [input.decision.competitorCents] : [])]);
  const found = amountsIn(t);
  for (const cents of found) if (!allowed.has(cents)) return `amount ${usd(cents)} is not in the data`;
  const status = input.decision.status;
  if (status === "approved" && !found.includes(input.decision.refundCents)) return "approved text must state the refund amount";
  if (status !== "approved" && REFUND_PROMISE[locale].test(t)) return "promises a refund the decision did not grant";
  return null;
}

export function templateExplanation(input: ExplainInput): string {
  const d = input.decision;
  const locale = input.locale ?? "en";
  const fail = d.checks.find((c) => c.outcome === "fail");
  const review = d.checks.find((c) => c.outcome === "review");
  if (locale === "en") {
    const where = input.competitor?.domain ?? "the other store";
    if (d.status === "approved") {
      return `You paid ${usd(input.paidCents)}, and ${where} sells the same product new and in stock for ${usd(d.competitorCents ?? 0)}. The ${usd(d.refundCents)} difference is being refunded to your PayPal account.`;
    }
    if (d.status === "refused") return `This offer doesn't qualify for a price match. ${fail?.detail ?? ""}`.trim();
    return `A person at the store will look at this claim, because it couldn't be confirmed automatically: ${review?.detail ?? "some details were missing."}`;
  }
  // Check details are English-only, so the other languages name the check that decided it instead.
  const labels = dict(locale).claim.checkLabels;
  const label = (c: { id: string; label: string } | undefined) => (c ? labels[c.id] ?? c.label : null);
  if (locale === "fr") {
    const where = input.competitor?.domain ?? "l'autre magasin";
    if (d.status === "approved") return `Vous avez payé ${usd(input.paidCents)}, et ${where} vend le même produit neuf et en stock à ${usd(d.competitorCents ?? 0)}. La différence de ${usd(d.refundCents)} vous est remboursée sur votre compte PayPal.`;
    if (d.status === "refused") return `Cette offre ne donne pas droit à l'alignement de prix.${label(fail) ? ` Point bloquant : ${label(fail)}.` : ""}`;
    return `Une personne du magasin va examiner cette demande, car elle n'a pas pu être confirmée automatiquement${label(review) ? ` (à vérifier : ${label(review)})` : ""}.`;
  }
  const where = input.competitor?.domain ?? "la otra tienda";
  if (d.status === "approved") return `Pagaste ${usd(input.paidCents)} y ${where} vende el mismo producto nuevo y en stock por ${usd(d.competitorCents ?? 0)}. Te devolvemos la diferencia de ${usd(d.refundCents)} en tu cuenta de PayPal.`;
  if (d.status === "refused") return `Esta oferta no da derecho a la igualación de precio.${label(fail) ? ` Motivo: ${label(fail)}.` : ""}`;
  return `Una persona de la tienda revisará esta solicitud, porque no se pudo confirmar automáticamente${label(review) ? ` (por revisar: ${label(review)})` : ""}.`;
}

export async function explainDecision(input: ExplainInput, opts: { providers?: LlmProvider[]; fetch?: typeof fetch } = {}): Promise<Explanation> {
  try {
    const { args, provider } = await callTool<{ text?: string }>(system(input.locale ?? "en"), facts(input), TOOL, {
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

/** The automatic check could not finish. */
export function checkUnfinishedText(locale: Locale): string {
  return locale === "fr" ? "La vérification automatique n'a pas pu aboutir : une personne du magasin va regarder votre demande. Rien n'a été débité ni remboursé."
    : locale === "es" ? "La comprobación automática no pudo terminar: una persona de la tienda revisará tu solicitud. No se ha cobrado ni reembolsado nada."
    : "The automatic check could not finish, so a person at the store will look at your claim. Nothing has been charged or refunded.";
}

/** A refund whose outcome was unknown has now been confirmed with PayPal. */
export function refundDoneText(locale: Locale, cents: number): string {
  const amount = usd(cents);
  return locale === "fr" ? `PayPal a confirmé votre remboursement de ${amount} sur votre compte PayPal.`
    : locale === "es" ? `PayPal confirmó tu reembolso de ${amount} en tu cuenta PayPal.`
    : `PayPal has confirmed your refund of ${amount} to your PayPal account.`;
}

/** The store's own decision on a claim sent to a person, in the shopper's language. */
export function reviewText(locale: Locale, outcome: { approvedCents: number } | { refused: true }, note: string): string {
  const extra = note ? (locale === "fr" ? ` Note du magasin : ${note}` : locale === "es" ? ` Nota de la tienda: ${note}` : ` Note from the store: ${note}`) : "";
  if ("approvedCents" in outcome) {
    const amount = usd(outcome.approvedCents);
    return (locale === "fr" ? `Une personne du magasin a vérifié votre demande et l'a acceptée : ${amount} vous sont remboursés sur votre compte PayPal.`
      : locale === "es" ? `Una persona de la tienda revisó tu solicitud y la aprobó: te reembolsamos ${amount} en tu cuenta PayPal.`
      : `A person at the store checked your claim and approved it: ${amount} is being refunded to your PayPal account.`) + extra;
  }
  return (locale === "fr" ? "Une personne du magasin a vérifié votre demande et ne peut pas l'accepter."
    : locale === "es" ? "Una persona de la tienda revisó tu solicitud y no puede aprobarla."
    : "A person at the store checked your claim and could not approve it.") + extra;
}

/** Shown when an approved refund does not go through, in the shopper's language. */
export function refundProblemText(locale: Locale, approvedCents: number, outcome: "unknown" | { reason: string }): string {
  const amount = usd(approvedCents);
  if (outcome === "unknown") {
    return locale === "fr" ? `Votre demande a été acceptée pour ${amount}. Nous confirmons le remboursement avec PayPal et mettrons cette page à jour.`
      : locale === "es" ? `Tu solicitud fue aprobada por ${amount}. Estamos confirmando el reembolso con PayPal y actualizaremos esta página.`
      : `Your claim was approved for ${amount}. We are confirming the refund with PayPal and will update this page.`;
  }
  return locale === "fr" ? `Votre demande a été acceptée pour ${amount}, mais le remboursement n'a pas pu aboutir : ${outcome.reason}`
    : locale === "es" ? `Tu solicitud fue aprobada por ${amount}, pero el reembolso no se pudo completar: ${outcome.reason}`
    : `Your claim was approved for ${amount}, but the refund could not be completed: ${outcome.reason}`;
}
