import { offerForDomain, type C3Product, type Channel3Client } from "@/lib/channel3";
import { callTool, LlmUnavailableError, visionProvidersFromEnv, type LlmProvider } from "@/lib/llm";
import { editionConflict } from "./identity";

// "Snap a price tag": the shopper sends a screenshot or photo of the cheaper offer instead of a link.
// The AI reads the offer from the image; Channel3 then finds that store's LIVE listing. The refund is
// always computed from the live price, never from the image, because an image can be edited.

export type Extraction = {
  product: string;
  brand: string | null;
  model: string | null;
  store: string | null;
  storeDomain: string | null;
  priceCents: number | null;
  currency: string | null;
  conditionWords: string[]; // e.g. "refurbished", "open box" when visible in the image
  urlVisible: string | null;
  confidence: "high" | "medium" | "low";
};

export type ImageReading = { extraction: Extraction; provider: string };

export type Resolution =
  | { ok: true; product: C3Product; domain: string; matchedBy: "link_in_image" | "purchased_product_offer" | "text_search" | "image_search" }
  | { ok: false; reason: string };

const SYSTEM = [
  "You read a screenshot or photo of a product offer (a store web page, an app, an ad or a shelf price tag).",
  "Report only what is visible. If something is not visible, return null for it. Never guess a price.",
  "store_domain: the store's website domain if you can tell it (for example bestbuy.com, target.com, walmart.com).",
  "condition_words: copy any words about condition that appear (refurbished, renewed, restored, open box, used, pre-owned, like new). Empty if none.",
  "url_visible: a full product URL only if one is clearly visible in the image.",
  "confidence: high if product, store and price are all clearly visible; low if the image is blurry or most fields are missing.",
].join("\n");

const TOOL = {
  name: "report_offer",
  description: "Report the offer shown in the image.",
  parameters: {
    type: "object",
    properties: {
      product: { type: "string", description: "Product name as shown" },
      brand: { type: ["string", "null"] },
      model: { type: ["string", "null"], description: "Model number or SKU if visible" },
      store: { type: ["string", "null"] },
      store_domain: { type: ["string", "null"] },
      price: { type: ["number", "null"], description: "The selling price shown, as a number" },
      currency: { type: ["string", "null"] },
      condition_words: { type: "array", items: { type: "string" } },
      url_visible: { type: ["string", "null"] },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["product", "price", "store", "confidence", "condition_words"],
  },
};

type RawExtraction = {
  product?: string; brand?: string | null; model?: string | null; store?: string | null; store_domain?: string | null;
  price?: number | null; currency?: string | null; condition_words?: string[]; url_visible?: string | null; confidence?: string;
};

export function normalizeDomain(d: string | null | undefined): string | null {
  if (!d) return null;
  const host = d.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]!.replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

// Common store names → domains, for when the AI names the store but gives no domain. A guessed domain
// only ever matters if Channel3 has an offer from it, so a wrong guess finds nothing rather than a
// wrong listing.
const KNOWN_STORES: Record<string, string> = {
  "best buy": "bestbuy.com", bestbuy: "bestbuy.com", target: "target.com", walmart: "walmart.com",
  "b&h": "bhphotovideo.com", "b&h photo": "bhphotovideo.com", "b&h photo video": "bhphotovideo.com", "bh photo": "bhphotovideo.com",
  amazon: "amazon.com", costco: "costco.com", "kohl's": "kohls.com", kohls: "kohls.com", "macy's": "macys.com", macys: "macys.com",
  "home depot": "homedepot.com", "the home depot": "homedepot.com", "lowe's": "lowes.com", lowes: "lowes.com",
  staples: "staples.com", "office depot": "officedepot.com", newegg: "newegg.com", "micro center": "microcenter.com",
  "back market": "backmarket.com", ebay: "ebay.com", "sam's club": "samsclub.com", "bj's": "bjs.com", qvc: "qvc.com",
  "dick's sporting goods": "dickssportinggoods.com", kitchenaid: "kitchenaid.com", bose: "bose.com", apple: "apple.com", dell: "dell.com",
};

export function storeDomainFor(store: string | null): string | null {
  if (!store) return null;
  const key = store.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.com$/, "");
  if (KNOWN_STORES[key]) return KNOWN_STORES[key]!;
  const slug = key.replace(/['&]/g, "").replace(/[^a-z0-9]+/g, "");
  return slug.length >= 3 ? `${slug}.com` : null;
}

export function parseExtraction(raw: RawExtraction): Extraction {
  const price = typeof raw.price === "number" && Number.isFinite(raw.price) && raw.price > 0 ? Math.round(raw.price * 100) : null;
  let url: string | null = null;
  try {
    if (raw.url_visible && /^https?:\/\//i.test(raw.url_visible)) url = new URL(raw.url_visible).toString();
  } catch {}
  const confidence = raw.confidence === "high" || raw.confidence === "medium" ? raw.confidence : "low";
  return {
    product: (raw.product ?? "").trim().slice(0, 200),
    brand: raw.brand?.trim() || null,
    model: raw.model?.trim() || null,
    store: raw.store?.trim() || null,
    storeDomain: normalizeDomain(raw.store_domain) ?? (url ? normalizeDomain(url) : null) ?? storeDomainFor(raw.store ?? null),
    priceCents: price,
    currency: raw.currency?.trim().toUpperCase() || null,
    conditionWords: (raw.condition_words ?? []).filter((w) => typeof w === "string" && w.trim()).map((w) => w.trim().toLowerCase()).slice(0, 5),
    urlVisible: url,
    confidence,
  };
}

/** Read the offer from an image. Returns null when no vision provider answers. */
export async function readOfferImage(
  image: { bytes: Uint8Array; mime: string },
  opts: { providers?: LlmProvider[]; fetch?: typeof fetch } = {},
): Promise<ImageReading | null> {
  const dataUrl = `data:${image.mime};base64,${Buffer.from(image.bytes).toString("base64")}`;
  try {
    const { args, provider } = await callTool<RawExtraction>(
      SYSTEM,
      [
        { type: "text", text: "Read the product offer in this image." },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
      TOOL,
      { providers: opts.providers ?? visionProvidersFromEnv(), ...(opts.fetch ? { fetch: opts.fetch } : {}), timeoutMs: 40_000 },
    );
    return { extraction: parseExtraction(args), provider };
  } catch (err) {
    if (err instanceof LlmUnavailableError) return null;
    throw err;
  }
}

/**
 * Find the store's live listing for what the image shows. Order: a link visible in the image, then
 * the purchased product's own offer at that store (the shopper is claiming THAT product is cheaper
 * there), then Channel3 text search, then Channel3 image search. Identity is still checked afterwards.
 */
/** Title words that identify a model: tokens with digits (T7, 1TB, XM5) count double. */
function titleTokens(t: string): Set<string> {
  return new Set(t.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1));
}

export function similarity(purchasedTitle: string, candidateTitle: string): number {
  const a = titleTokens(purchasedTitle);
  let score = 0;
  for (const w of titleTokens(candidateTitle)) if (a.has(w)) score += /\d/.test(w) ? 2 : 1;
  return score;
}

/**
 * Does the image show the product that was bought? The listing found afterwards can be the purchased
 * product's own (matched by store alone), so without this a screenshot of ANY product at a store that
 * sells the purchased one cheaper would pass (found live 2026-10-29: a Samsung SSD screenshot on a
 * GoPro order). The brand read from the image must appear in the purchased title, and the product
 * words must share at least one word with it.
 */
export function imageMatchesPurchase(ex: Extraction, purchasedTitle: string): { ok: boolean; shown: string } {
  const shown = [ex.brand, ex.product, ex.model].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const title = titleTokens(purchasedTitle);
  const brandTokens = ex.brand ? [...titleTokens(ex.brand)] : [];
  const brandOk = brandTokens.length === 0 || brandTokens.some((w) => title.has(w));
  const productWords = [...titleTokens([ex.product, ex.model].filter(Boolean).join(" "))].filter((w) => !brandTokens.includes(w));
  const productOk = productWords.some((w) => title.has(w));
  return { ok: brandOk && productOk, shown };
}

/**
 * How well a store listing fits the claim: title closeness to the purchased product, minus a penalty
 * for an edition word in only one title, plus a strong bonus when the store's price matches the price
 * in the image (that price identifies WHICH listing the screenshot shows; the refund still uses the
 * live price).
 */
export function listingScore(purchasedTitle: string, candidate: C3Product, domain: string, imagePriceCents: number | null): number {
  let score = similarity(purchasedTitle, candidate.title);
  if (editionConflict(purchasedTitle, candidate.title)) score -= 4;
  const storeOffer = offerForDomain(candidate, domain);
  if (storeOffer && imagePriceCents !== null && Math.abs(Math.round(storeOffer.price.price * 100) - imagePriceCents) <= 100) score += 6;
  return score;
}

/**
 * Find the store's live listing for what the image shows. Order: a link visible in the image, then
 * the purchased product's own offer at that store (the shopper is claiming THAT product is cheaper
 * there), then Channel3 search by the purchased product's title, by the text read from the image and
 * by the image itself. Among results with an offer at that store, the closest title to the purchased
 * product wins. Identity is still checked afterwards by the AI.
 */
export async function resolveListing(
  extraction: Extraction,
  purchased: { id: string; title: string },
  channel3: Channel3Client,
  imageBase64?: string,
): Promise<Resolution> {
  if (extraction.urlVisible) {
    try {
      const product = await channel3.lookup(extraction.urlVisible);
      return { ok: true, product, domain: normalizeDomain(extraction.urlVisible)!, matchedBy: "link_in_image" };
    } catch {
      // fall through to the store-based paths
    }
  }
  const domain = extraction.storeDomain;
  if (!domain) return { ok: false, reason: "The store could not be identified from the image." };

  try {
    const own = await channel3.product(purchased.id);
    if (offerForDomain(own, domain)) return { ok: true, product: own, domain, matchedBy: "purchased_product_offer" };
  } catch {}

  if (!channel3.search) return { ok: false, reason: `No live listing at ${domain} was found for this product.` };
  const imageText = [extraction.brand, extraction.product, extraction.model].filter(Boolean).join(" ").trim();
  const searches: { matchedBy: "text_search" | "image_search"; run: () => Promise<C3Product[]> }[] = [
    // Searches are limited to the store in the image, so every result carries an offer from it.
    { matchedBy: "text_search", run: () => channel3.search!({ text: purchased.title, websiteDomain: domain }, 10) },
    ...(imageText ? [{ matchedBy: "text_search" as const, run: () => channel3.search!({ text: imageText, websiteDomain: domain }, 10) }] : []),
    ...(imageBase64 ? [{ matchedBy: "image_search" as const, run: () => channel3.search!({ base64Image: imageBase64, websiteDomain: domain }, 10) }] : []),
  ];
  let best: { product: C3Product; score: number; matchedBy: "text_search" | "image_search" } | null = null;
  for (const s of searches) {
    let results: C3Product[] = [];
    try {
      results = await s.run();
    } catch {
      continue;
    }
    for (const p of results) {
      if (!offerForDomain(p, domain)) continue;
      const score = listingScore(purchased.title, p, domain, extraction.priceCents);
      if (!best || score > best.score) best = { product: p, score, matchedBy: s.matchedBy };
    }
  }
  if (best) return { ok: true, product: best.product, domain, matchedBy: best.matchedBy };
  return { ok: false, reason: `No live listing at ${domain} was found for this product.` };
}
