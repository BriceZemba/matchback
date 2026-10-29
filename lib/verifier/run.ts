import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDb, now } from "@/lib/db";
import { cachedChannel3, cacheModeFromEnv } from "@/lib/channel3-cache";
import { Channel3Error, createChannel3Client, domainOf, offerForDomain, type C3PriceStats, type C3Product, type Channel3Client } from "@/lib/channel3";
import type { LlmProvider } from "@/lib/llm";
import { getOrderRow } from "@/lib/paypal/checkout";
import { InvariantError, OutcomeUnknownError, PaypalRefusedError, friendlyRefusal } from "@/lib/paypal/errors";
import { issuePriceMatchRefund } from "@/lib/paypal/refunds";
import { explainDecision, type Explanation } from "./explain";
import { readOfferImage, resolveListing, type Extraction } from "./image-intake";
import { checkIdentity, type IdentityMode, type IdentityVerdict } from "./identity";
import { decide, isResaleDomain, settingsFromEnv, type Check, type ConditionSource, type Decision, type PolicySettings } from "./policy";

export type ClaimStatus = "verifying" | "approved" | "refused" | "needs_review" | "refunded" | "refund_unknown" | "refund_failed";

export type ClaimRow = {
  id: string;
  order_id: string;
  competitor_url: string;
  status: ClaimStatus;
  decision_json: string | null;
  refund_id: string | null;
  error: string | null;
  created_at: string;
  decided_at: string | null;
  source: "link" | "image";
  image_path: string | null;
  image_mime: string | null;
  competitor_domain: string | null;
};

export type ClaimEvidence = {
  decision: Decision;
  identity: IdentityVerdict | null;
  competitor: { productId: string; title: string; domain: string; offerUrl?: string; condition: string | null; conditionSource: ConditionSource; availability?: string } | null;
  purchased: { productId: string; title: string };
  priceContext: C3PriceStats | null;
  lookupError?: string;
  explanation?: Explanation;
  /** Screenshot claims: what the AI read and how the live listing was found. */
  image?: { extraction: Extraction | null; provider: string | null; matchedBy: string | null; reason?: string };
};

export function getClaim(id: string): ClaimRow | undefined {
  return getDb().prepare("SELECT * FROM claims WHERE id = ?").get(id) as ClaimRow | undefined;
}

export function claimsForOrder(orderId: string): ClaimRow[] {
  return getDb().prepare("SELECT * FROM claims WHERE order_id = ? ORDER BY created_at DESC").all(orderId) as ClaimRow[];
}

/** File a claim. Checks run before anything is stored or any provider is called. */
export function fileClaim(orderId: string, competitorUrl: string): ClaimRow {
  const order = getOrderRow(orderId);
  if (!order || order.status !== "captured") throw new InvariantError(409, "Price-match claims are for paid orders only.");
  let url: URL;
  try {
    url = new URL(competitorUrl.trim());
  } catch {
    throw new InvariantError(400, "Paste the full link to the competitor's product page.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new InvariantError(400, "Only web links are accepted.");
  const id = randomUUID();
  getDb().prepare("INSERT INTO claims (id, order_id, competitor_url, status, created_at) VALUES (?, ?, ?, 'verifying', ?)")
    .run(id, orderId, url.toString(), now());
  return getClaim(id)!;
}

export const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** File a claim from a screenshot or photo of the cheaper offer. */
export function fileImageClaim(orderId: string, image: { bytes: Uint8Array; mime: string }): ClaimRow {
  const order = getOrderRow(orderId);
  if (!order || order.status !== "captured") throw new InvariantError(409, "Price-match claims are for paid orders only.");
  const ext = IMAGE_TYPES[image.mime];
  if (!ext) throw new InvariantError(415, "Upload a PNG, JPEG or WebP image.");
  if (image.bytes.byteLength === 0 || image.bytes.byteLength > MAX_IMAGE_BYTES) throw new InvariantError(413, "The image must be under 5 MB.");
  const id = randomUUID();
  const dir = join(dirname(process.env.MATCHBACK_DB ?? "data/matchback.db"), "uploads");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.${ext}`);
  writeFileSync(path, image.bytes);
  getDb()
    .prepare("INSERT INTO claims (id, order_id, competitor_url, status, created_at, source, image_path, image_mime) VALUES (?, ?, ?, 'verifying', ?, 'image', ?, ?)")
    .run(id, orderId, `upload:${id}`, now(), path, image.mime);
  return getClaim(id)!;
}

/** Checks specific to screenshot claims, added to the policy's checks. */
function imageChecks(ex: Extraction, liveCents: number | null): Check[] {
  const checks: Check[] = [];
  const read = [ex.product, ex.store ? `at ${ex.store}` : null, ex.priceCents !== null ? `$${(ex.priceCents / 100).toFixed(2)}` : null].filter(Boolean).join(" ");
  checks.push({ id: "image_read", label: "Read from your image", outcome: ex.confidence === "low" ? "review" : "pass", detail: `AI read: ${read} (${ex.confidence} confidence).` });
  const flagged = ex.conditionWords.filter((w) => /refurb|renew|restor|open.?box|used|pre.?owned|like new|second.?hand/.test(w));
  if (flagged.length) checks.push({ id: "image_condition", label: "Sold new", outcome: "fail", detail: `The image says "${flagged.join(", ")}".` });
  if (ex.priceCents !== null && liveCents !== null) {
    const same = Math.abs(ex.priceCents - liveCents) <= 100;
    checks.push({
      id: "image_price",
      label: "Live price confirmed",
      outcome: "pass",
      detail: same
        ? `The image shows $${(ex.priceCents / 100).toFixed(2)}; the store's live price matches.`
        : `The image shows $${(ex.priceCents / 100).toFixed(2)}; the store's live price is $${(liveCents / 100).toFixed(2)}. Matchback always uses the live price.`,
    });
  }
  return checks;
}

function statusFrom(checks: Check[]): Decision["status"] {
  return checks.some((c) => c.outcome === "fail") ? "refused" : checks.some((c) => c.outcome === "review") ? "needs_review" : "approved";
}

export type VerifyDeps = {
  channel3: Channel3Client;
  settings: PolicySettings;
  identityMode: IdentityMode;
  providers?: LlmProvider[];
  llmFetch?: typeof fetch;
  refund: typeof issuePriceMatchRefund;
  now: () => Date;
};

export function defaultDeps(): VerifyDeps {
  return {
    channel3: cachedChannel3(createChannel3Client(), getDb(), { mode: cacheModeFromEnv() }),
    settings: settingsFromEnv(),
    identityMode: process.env.MATCHBACK_IDENTITY_MODE === "id_only" ? "id_only" : "ai",
    refund: issuePriceMatchRefund,
    now: () => new Date(),
  };
}

/** Evaluate a claim without touching the store or PayPal. Shared by the app and the evaluation harness. */
export async function evaluateClaim(
  input: {
    purchasedProductId: string; purchasedTitle: string; paidCents: number; currency: string; capturedAt: string; competitorUrl: string;
    /** Already-found listing (screenshot claims): skip the page lookup and use this product and store. */
    resolved?: { product: C3Product; domain: string };
  },
  deps: Pick<VerifyDeps, "channel3" | "settings" | "identityMode" | "providers" | "llmFetch" | "now">,
): Promise<ClaimEvidence> {
  const domain = input.resolved?.domain ?? domainOf(input.competitorUrl);
  const purchased = { productId: input.purchasedProductId, title: input.purchasedTitle };
  const base = { paidCents: input.paidCents, currency: input.currency, capturedAt: input.capturedAt, now: deps.now(), competitorDomain: domain, settings: deps.settings };

  let competitorProduct;
  try {
    competitorProduct = input.resolved?.product ?? (await deps.channel3.lookup(input.competitorUrl));
  } catch (err) {
    const reason = err instanceof Channel3Error ? `Channel3 could not read that page (${err.status}: ${err.message}).` : "Channel3 lookup failed.";
    const decision = decide({ ...base, offer: undefined, identity: null });
    decision.checks.unshift({ id: "lookup", label: "Competitor page readable", outcome: "review", detail: reason });
    if (decision.status === "approved") decision.status = "needs_review";
    return { decision, identity: null, competitor: null, purchased, priceContext: null, lookupError: reason };
  }

  // Channel3 sometimes omits an offer's condition on a URL lookup and states it a minute later (B&H,
  // 2026-10-29). Before a missing condition sends the claim to a person, read the same retailer's offer
  // from the product record by id. Resale sites are refused regardless, so they skip this.
  let offer = offerForDomain(competitorProduct, domain);
  let conditionSource: ConditionSource = offer?.condition ? "page_lookup" : "none";
  if ((!offer || !offer.condition) && !isResaleDomain(domain)) {
    try {
      const detailOffer = offerForDomain(await deps.channel3.product(competitorProduct.id), domain);
      if (detailOffer?.condition) {
        offer = detailOffer;
        conditionSource = "product_record";
      } else if (!offer && detailOffer) {
        offer = detailOffer;
      }
    } catch {
      // keep what the lookup gave; the policy sends a missing condition to review
    }
  }
  let identity: IdentityVerdict | null = null;
  try {
    const purchasedProduct = competitorProduct.id === input.purchasedProductId ? competitorProduct : await deps.channel3.product(input.purchasedProductId);
    identity = await checkIdentity(purchasedProduct, competitorProduct, {
      mode: deps.identityMode,
      ...(deps.providers ? { providers: deps.providers } : {}),
      ...(deps.llmFetch ? { fetch: deps.llmFetch } : {}),
    });
  } catch {
    identity = null;
  }
  const priceContext = await deps.channel3.priceStats(competitorProduct.id);
  const decision = decide({ ...base, offer, identity, conditionSource });
  return {
    decision,
    identity,
    competitor: {
      productId: competitorProduct.id,
      title: competitorProduct.title,
      domain,
      ...(offer?.url ? { offerUrl: offer.url } : {}),
      condition: offer?.condition ?? null,
      conditionSource,
      ...(offer?.availability ? { availability: offer.availability } : {}),
    },
    purchased,
    priceContext,
  };
}

/** Screenshot claim: AI reads the image, Channel3 finds the live listing, then the usual verifier runs. */
async function evaluateImageClaim(
  claim: ClaimRow,
  claimInput: Parameters<typeof evaluateClaim>[0],
  deps: VerifyDeps,
): Promise<ClaimEvidence> {
  const db = getDb();
  const purchased = { productId: claimInput.purchasedProductId, title: claimInput.purchasedTitle };
  const bytes = new Uint8Array(readFileSync(claim.image_path!));
  const reading = await readOfferImage(
    { bytes, mime: claim.image_mime! },
    { ...(deps.providers ? { providers: deps.providers } : {}), ...(deps.llmFetch ? { fetch: deps.llmFetch } : {}) },
  );
  const stop = (reason: string, extraction: Extraction | null, provider: string | null): ClaimEvidence => {
    const checks: Check[] = [{ id: "image_read", label: "Read from your image", outcome: "review", detail: reason }];
    return {
      decision: { status: "needs_review", refundCents: 0, competitorCents: null, checks },
      identity: null, competitor: null, purchased, priceContext: null,
      image: { extraction, provider, matchedBy: null, reason },
    };
  };
  if (!reading) return stop("The image could not be read automatically right now.", null, null);
  const ex = reading.extraction;
  const resolution = await resolveListing(ex, { id: claimInput.purchasedProductId, title: claimInput.purchasedTitle }, deps.channel3, Buffer.from(bytes).toString("base64"));
  if (!resolution.ok) {
    const checks: Check[] = [...imageChecks(ex, null), { id: "listing", label: "Store's live listing found", outcome: "review", detail: resolution.reason }];
    return {
      decision: { status: statusFrom(checks), refundCents: 0, competitorCents: null, checks },
      identity: null, competitor: null, purchased, priceContext: null,
      image: { extraction: ex, provider: reading.provider, matchedBy: null, reason: resolution.reason },
    };
  }
  const offer = offerForDomain(resolution.product, resolution.domain);
  db.prepare("UPDATE claims SET competitor_url = ?, competitor_domain = ? WHERE id = ?")
    .run(offer?.url ?? `https://${resolution.domain}/`, resolution.domain, claim.id);
  const evidence = await evaluateClaim({ ...claimInput, competitorUrl: `https://${resolution.domain}/`, resolved: { product: resolution.product, domain: resolution.domain } }, deps);
  // A listing found by SEARCH may simply be the wrong one. If its identity is not confirmed, comparing
  // its price or stock says nothing about the shopper's offer: send the claim to a person instead of
  // refusing it. Refusals on screenshot claims come only from evidence in the image or from listings
  // found by link or on the purchased product's own record.
  const searched = resolution.matchedBy === "text_search" || resolution.matchedBy === "image_search";
  const identityOk = evidence.decision.checks.find((c) => c.id === "identity")?.outcome === "pass";
  if (searched && !identityOk) {
    const closest = evidence.competitor?.title ?? "another product";
    evidence.decision.checks = [
      { id: "listing", label: "Store's live listing found", outcome: "review", detail: `The closest listing found at ${resolution.domain} is "${closest}", which is not the product you bought. A person will confirm the offer in your screenshot.` },
    ];
    evidence.decision.refundCents = 0;
    evidence.decision.checks.unshift(...imageChecks(ex, null));
  } else {
    evidence.decision.checks.unshift(...imageChecks(ex, evidence.decision.competitorCents));
  }
  evidence.decision.status = statusFrom(evidence.decision.checks);
  evidence.image = { extraction: ex, provider: reading.provider, matchedBy: resolution.matchedBy };
  return evidence;
}

/** Verify a filed claim and, when approved, refund the difference on the PayPal capture. */
export async function verifyClaim(claimId: string, deps: VerifyDeps = defaultDeps()): Promise<ClaimRow> {
  const db = getDb();
  const claim = getClaim(claimId);
  if (!claim) throw new InvariantError(404, "Unknown claim.");
  if (claim.status !== "verifying") return claim;
  const order = getOrderRow(claim.order_id)!;
  const product = db.prepare("SELECT title FROM catalog WHERE product_id = ?").get(order.product_id) as { title: string };

  const claimInput = {
    purchasedProductId: order.product_id,
    purchasedTitle: product.title,
    paidCents: order.captured_cents ?? order.amount_cents,
    currency: order.currency,
    capturedAt: order.captured_at ?? (db.prepare("SELECT created_at FROM orders WHERE id = ?").get(order.id) as { created_at: string }).created_at,
    competitorUrl: claim.competitor_url,
  };

  let evidence: ClaimEvidence;
  if (claim.source === "image") {
    evidence = await evaluateImageClaim(claim, claimInput, deps);
  } else {
    evidence = await evaluateClaim(claimInput, deps);
  }

  // Plain-language explanation for the shopper, written from the checks; it never changes the decision.
  evidence.explanation = await explainDecision(
    {
      decision: evidence.decision,
      identity: evidence.identity,
      purchasedTitle: product.title,
      paidCents: order.captured_cents ?? order.amount_cents,
      competitor: evidence.competitor,
    },
    { ...(deps.providers ? { providers: deps.providers } : {}), ...(deps.llmFetch ? { fetch: deps.llmFetch } : {}) },
  );

  const save = (status: ClaimStatus, extra: { refund_id?: string; error?: string } = {}) => {
    db.prepare("UPDATE claims SET status = ?, decision_json = ?, refund_id = COALESCE(?, refund_id), error = ?, decided_at = ? WHERE id = ?")
      .run(status, JSON.stringify(evidence), extra.refund_id ?? null, extra.error ?? null, now(), claimId);
  };

  if (evidence.decision.status !== "approved") {
    save(evidence.decision.status);
    return getClaim(claimId)!;
  }

  save("approved");
  try {
    const refund = await deps.refund({
      claimId,
      orderId: order.id,
      amountCents: evidence.decision.refundCents,
      retailer: evidence.competitor?.domain ?? "a competing retailer",
    });
    save("refunded", { refund_id: refund.refundId });
  } catch (err) {
    // The explanation was written expecting a refund; when the refund does not go through, say so.
    const approvedFor = `$${(evidence.decision.refundCents / 100).toFixed(2)}`;
    evidence.explanation = {
      source: "template",
      text: err instanceof OutcomeUnknownError
        ? `Your claim was approved for ${approvedFor}. We are confirming the refund with PayPal and will update this page.`
        : `Your claim was approved for ${approvedFor}, but the refund could not be completed: ${err instanceof PaypalRefusedError ? friendlyRefusal(err.issue) : err instanceof InvariantError ? err.message : "please contact the store."}`,
    };
    if (err instanceof OutcomeUnknownError) save("refund_unknown", { error: "Refund outcome unknown; checking with PayPal." });
    else if (err instanceof PaypalRefusedError) save("refund_failed", { error: friendlyRefusal(err.issue) });
    else if (err instanceof InvariantError) save("refund_failed", { error: err.message });
    else save("refund_failed", { error: "Refund could not be completed." });
  }
  return getClaim(claimId)!;
}
