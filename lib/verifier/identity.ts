import type { C3Product } from "@/lib/channel3";
import { callTool, LlmUnavailableError, type LlmProvider } from "@/lib/llm";

// Is the competitor's listing the same product the shopper bought? Channel3 splits colour variants into
// separate ids and gives some products several ids, while bundles and sibling models get their own
// (spike, 2026-10-28). So a matching id settles it; a different id goes to the AI, which classifies the
// relation. The policy, not the AI, decides what each relation means.

export const RELATIONS = [
  "same_product",
  "same_product_other_color",
  "different_model",
  "bundle_or_kit",
  "accessory_or_part",
  "used_or_refurbished_listing",
  "cannot_tell",
] as const;
export type IdentityRelation = (typeof RELATIONS)[number];

export type IdentityVerdict = {
  relation: IdentityRelation;
  method: "channel3_id" | "llm" | "id_only";
  evidence: string[];
  provider?: string;
};

/** "ai" is the product; "id_only" is the ablation baseline that trusts Channel3 ids alone. */
export type IdentityMode = "ai" | "id_only";

const SYSTEM = [
  "You compare two retail product listings and classify how the competitor listing relates to the product the shopper bought.",
  "Rules:",
  "- same_product: same brand, model and configuration (capacity, size, generation, model number).",
  "- same_product_other_color: identical except colour or finish.",
  "- different_model: any difference in model, generation, capacity, size, storage, edition or model number (e.g. 'Shield' vs plain, 'Signature Edition' vs standard).",
  "- bundle_or_kit: the competitor sells the product together with extra items.",
  "- accessory_or_part: the competitor sells an accessory, case, part or replacement for it.",
  "- used_or_refurbished_listing: the listing says used, refurbished, renewed, open-box or pre-owned.",
  "- cannot_tell: the data is not enough to decide. Prefer this over guessing.",
  "Edition qualifiers decide: if one listing carries one of these and the other does not, answer different_model even when every feature matches: 'for Business', 'for Mac', 'Bluetooth Edition', 'Kids', 'Pro', 'Plus', 'Lite', 'Mini', 'Max', 'Signature', 'Shield', 'International', 'JP/Japan version'.",
  "Retailer titles often drop words (the model name, the year, the generation, the brand) or add marketing text and the store's name. A word that is merely missing from one title is NOT evidence of a different model: decide from features, attributes, description, capacity and model numbers.",
  "Generation or year markers ('1st Gen' vs '2nd Gen', '2022' vs '2024') mean different_model only when BOTH listings state one and they differ. A colour or finish word alone (Graphite, Black, Pale Gray, Jade, Empire Red) means same_product_other_color.",
  "Quote at most three short pieces of evidence from the listings. Never invent attributes.",
].join("\n");

const TOOL = {
  name: "report_identity",
  description: "Report how the competitor listing relates to the purchased product.",
  parameters: {
    type: "object",
    properties: {
      relation: { type: "string", enum: [...RELATIONS] },
      evidence: { type: "array", items: { type: "string" }, maxItems: 3 },
    },
    required: ["relation", "evidence"],
  },
};

function describe(p: C3Product): string {
  const attrs = Object.entries(p.structured_attributes ?? {})
    .slice(0, 12)
    .map(([k, v]) => `${k}: ${v.slice(0, 3).join(", ")}`);
  const lines = [
    `title: ${p.title}`,
    `brand: ${(p.brands ?? []).map((b) => b.name).join(", ") || "unknown"}`,
    p.category ? `category: ${p.category}` : "",
    p.variants?.selected?.length ? `selected variant: ${p.variants.selected.map((v) => `${v.name}=${v.label}`).join(", ")}` : "",
    (p.key_features ?? []).length ? `features: ${(p.key_features ?? []).slice(0, 6).join(" | ")}` : "",
    attrs.length ? `attributes: ${attrs.join("; ")}` : "",
    p.description ? `description: ${p.description.slice(0, 400)}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

// Edition words: present in exactly one of the two titles means a different model. Checked in code as
// well as in the prompt, because the AI missed "for Business" on 2026-10-29 (eval cases mx-05, mx-08).
const EDITION_WORDS = [
  "for business", "business edition", "for mac", "bluetooth edition", "kids", "lite", "mini", "plus", "max",
  "signature edition", "shield", "international", "global version", "jp version", "japan version",
];

function normalizeTitle(t: string): string {
  return ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Generation markers like "2nd gen" / "1st generation" / "gen 2". */
function generationOf(t: string): string | null {
  const m = normalizeTitle(t).match(/ (\d)(?:st|nd|rd|th)? gen(?:eration)? | gen(?:eration)? (\d) /);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/** A reason the two titles cannot be the same model, or null. Only ever used to downgrade a match. */
export function editionConflict(purchasedTitle: string, competitorTitle: string): string | null {
  const a = normalizeTitle(purchasedTitle);
  const b = normalizeTitle(competitorTitle);
  for (const w of EDITION_WORDS) {
    const inA = a.includes(` ${w} `);
    const inB = b.includes(` ${w} `);
    if (inA !== inB) return `"${w}" appears in only one of the two titles.`;
  }
  const ga = generationOf(purchasedTitle);
  const gb = generationOf(competitorTitle);
  if (ga && gb && ga !== gb) return `Generation ${ga} vs generation ${gb}.`;
  return null;
}

export async function checkIdentity(
  purchased: C3Product,
  competitor: C3Product,
  opts: { mode?: IdentityMode; providers?: LlmProvider[]; fetch?: typeof fetch } = {},
): Promise<IdentityVerdict | null> {
  if (competitor.id === purchased.id) {
    return { relation: "same_product", method: "channel3_id", evidence: [`Channel3 resolved the link to the same catalog product (${purchased.id}).`] };
  }
  if (opts.mode === "id_only") {
    return { relation: "different_model", method: "id_only", evidence: [`Different Channel3 ids (${purchased.id} vs ${competitor.id}).`] };
  }
  const user = `PURCHASED PRODUCT\n${describe(purchased)}\n\nCOMPETITOR LISTING\n${describe(competitor)}`;
  try {
    const { args, provider } = await callTool<{ relation: string; evidence?: string[] }>(SYSTEM, user, TOOL, {
      ...(opts.providers ? { providers: opts.providers } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    let relation = (RELATIONS as readonly string[]).includes(args.relation) ? (args.relation as IdentityRelation) : "cannot_tell";
    const evidence = (args.evidence ?? []).filter((e) => typeof e === "string").slice(0, 3).map((e) => e.slice(0, 160));
    // The edition guard can only overrule a match, never create one.
    const conflict = relation === "same_product" || relation === "same_product_other_color" ? editionConflict(purchased.title, competitor.title) : null;
    if (conflict) {
      relation = "different_model";
      evidence.unshift(`Edition check: ${conflict}`);
    }
    return { relation, method: "llm", evidence, provider };
  } catch (err) {
    if (err instanceof LlmUnavailableError) return null; // the policy sends the claim to a person
    throw err;
  }
}
