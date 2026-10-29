import type { C3Offer } from "@/lib/channel3";
import type { IdentityVerdict } from "./identity";

// The price-match policy, as a pure function: every check is deterministic and explained. The AI never
// decides; it only supplies the identity verdict, which this policy maps to pass / fail / review.

/** Resale and refurbished marketplaces. Seeded from the domains whose offers carried no condition in the
 * Channel3 spike (backmarket.com, fromrebel.com), plus well-known resale sites. */
export const RESALE_DOMAINS = [
  "backmarket.com",
  "fromrebel.com",
  "ebay.com",
  "swappa.com",
  "mercari.com",
  "poshmark.com",
  "decluttr.com",
  "gazelle.com",
  "therealreal.com",
  "thredup.com",
];

export type PolicySettings = {
  windowDays: number; // claims accepted this many days after capture
  minDiffCents: number; // ignore differences smaller than this
  floorShare: number; // a competitor price under this share of ours goes to a human
  allowColorVariants: boolean; // same model in another colour qualifies
};

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): PolicySettings {
  const num = (v: string | undefined, d: number) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    windowDays: num(env.MATCHBACK_WINDOW_DAYS, 14),
    minDiffCents: num(env.MATCHBACK_MIN_DIFF_CENTS, 100),
    floorShare: num(env.MATCHBACK_PRICE_FLOOR_SHARE, 0.6),
    allowColorVariants: env.MATCHBACK_ALLOW_COLOR_VARIANTS !== "0",
  };
}

export type CheckOutcome = "pass" | "fail" | "review";
export type Check = { id: string; label: string; outcome: CheckOutcome; detail: string };
export type DecisionStatus = "approved" | "refused" | "needs_review";
/** Where the offer's condition came from: the page lookup, Channel3's product record (second source), or nowhere. */
export type ConditionSource = "page_lookup" | "product_record" | "none";
export type Decision = { status: DecisionStatus; refundCents: number; competitorCents: number | null; checks: Check[] };

export type PolicyInput = {
  paidCents: number;
  currency: string;
  capturedAt: string;
  now: Date;
  competitorDomain: string;
  offer: C3Offer | undefined;
  identity: IdentityVerdict | null; // null: identity could not be established (lookup or AI unavailable)
  settings: PolicySettings;
  conditionSource?: ConditionSource;
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function isResaleDomain(domain: string): boolean {
  return RESALE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function decide(input: PolicyInput): Decision {
  const { paidCents, offer, settings: s } = input;
  const checks: Check[] = [];
  const add = (id: string, label: string, outcome: CheckOutcome, detail: string) => checks.push({ id, label, outcome, detail });

  const ageDays = (input.now.getTime() - new Date(input.capturedAt).getTime()) / 86_400_000;
  add("window", "Within the claim window", ageDays <= s.windowDays ? "pass" : "fail",
    `Paid ${Math.floor(ageDays)} day(s) ago; the window is ${s.windowDays} days.`);

  if (isResaleDomain(input.competitorDomain)) {
    add("retailer", "Qualifying retailer", "fail", `${input.competitorDomain} is a resale or refurbished marketplace.`);
  } else {
    add("retailer", "Qualifying retailer", "pass", `${input.competitorDomain} is not a resale marketplace.`);
  }

  if (!offer) {
    add("offer", "Competitor offer found", "review", `Channel3 returned no offer from ${input.competitorDomain} for this product.`);
  } else {
    const c = offer.condition ?? null;
    if (c === "new") add("condition", "Sold new", "pass", input.conditionSource === "product_record" ? "The offer's condition is new (confirmed from Channel3's product record; the page lookup gave none)." : "The offer's condition is new.");
    else if (c === "used" || c === "refurbished") add("condition", "Sold new", "fail", `The offer's condition is ${c}.`);
    else add("condition", "Sold new", "review", "Neither the page lookup nor Channel3's product record states a condition, so it is not proven new.");

    if (offer.availability === "InStock") add("stock", "In stock", "pass", "The offer is in stock.");
    else if (offer.availability === "OutOfStock") add("stock", "In stock", "fail", "The offer is out of stock.");
    else add("stock", "In stock", "review", "Availability is unknown.");

    if (offer.price.currency !== input.currency) {
      add("currency", "Same currency", "review", `Offer is in ${offer.price.currency}, the order in ${input.currency}.`);
    }
  }

  const competitorCents = offer ? Math.round(offer.price.price * 100) : null;
  if (competitorCents !== null) {
    const diff = paidCents - competitorCents;
    add("cheaper", "Lower price", diff >= s.minDiffCents ? "pass" : "fail",
      `${dollars(competitorCents)} there vs ${dollars(paidCents)} paid (difference ${dollars(Math.max(diff, 0))}).`);
    const floor = Math.ceil(paidCents * s.floorShare);
    add("floor", "Plausible price", competitorCents >= floor ? "pass" : "review",
      competitorCents >= floor ? `Above the ${Math.round(s.floorShare * 100)}% plausibility floor.` : `Below ${dollars(floor)} (${Math.round(s.floorShare * 100)}% of the price paid); a person should look.`);
  }

  const id = input.identity;
  if (!id) {
    add("identity", "Same product", "review", "Product identity could not be established automatically.");
  } else {
    const how = id.method === "channel3_id" ? "Channel3 catalog id" : `AI comparison (${id.provider ?? "llm"})`;
    switch (id.relation) {
      case "same_product":
        add("identity", "Same product", "pass", `${how}: same product. ${id.evidence.join(" ")}`.trim());
        break;
      case "same_product_other_color":
        add("identity", "Same product", s.allowColorVariants ? "pass" : "fail", `${how}: same model, different colour. ${id.evidence.join(" ")}`.trim());
        break;
      case "cannot_tell":
        add("identity", "Same product", "review", `${how}: not enough information. ${id.evidence.join(" ")}`.trim());
        break;
      default:
        add("identity", "Same product", "fail", `${how}: ${id.relation.replaceAll("_", " ")}. ${id.evidence.join(" ")}`.trim());
    }
  }

  const status: DecisionStatus = checks.some((c) => c.outcome === "fail") ? "refused" : checks.some((c) => c.outcome === "review") ? "needs_review" : "approved";
  const refundCents = competitorCents !== null ? Math.max(paidCents - competitorCents, 0) : 0;
  return { status, refundCents, competitorCents, checks };
}
