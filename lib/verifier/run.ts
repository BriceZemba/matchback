import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { getDb, now } from "@/lib/db";
import { cachedChannel3, cacheModeFromEnv } from "@/lib/channel3-cache";
import { Channel3Error, createChannel3Client, domainOf, offerForDomain, type C3PriceStats, type C3Product, type Channel3Client } from "@/lib/channel3";
import type { LlmProvider } from "@/lib/llm";
import { getOrderRow } from "@/lib/paypal/checkout";
import { InvariantError, OutcomeUnknownError, PaypalRefusedError, friendlyRefusal } from "@/lib/paypal/errors";
import { issuePriceMatchRefund, maxRefundShare } from "@/lib/paypal/refunds";
import { explainDecision, refundDoneText, refundProblemText, reviewText, type Explanation } from "./explain";
import type { Locale } from "@/lib/i18n";
import { imageMatchesPurchase, readOfferImage, resolveListing, type Extraction } from "./image-intake";
import { checkIdentity, type IdentityMode, type IdentityVerdict } from "./identity";
import { isKnownRetailer } from "./retailers";
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
  source: "link" | "image" | "watch";
  image_path: string | null;
  image_mime: string | null;
  competitor_domain: string | null;
  /** The shopper's language when they filed; the explanation is written in it. */
  locale: Locale;
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
  /** The store's decision on a claim the verifier sent to a person. */
  review?: { outcome: "approved" | "refused"; note: string; amountCents: number | null; at: string };
};

// Every column except image_data: the screenshot bytes are read only when the image itself is served.
const CLAIM_COLUMNS = "id, order_id, competitor_url, status, decision_json, refund_id, error, created_at, decided_at, source, image_path, image_mime, competitor_domain, locale";

export async function getClaim(id: string): Promise<ClaimRow | undefined> {
  return await getDb().get(`SELECT ${CLAIM_COLUMNS} FROM claims WHERE id = ?`, id) as ClaimRow | undefined;
}

/** The screenshot of an image claim: from the database, or from disk for claims filed before that. */
export async function getClaimImage(id: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | undefined> {
  const row = await getDb().get("SELECT image_data, image_path, image_mime FROM claims WHERE id = ? AND source = 'image'", id) as
    | { image_data: Uint8Array | null; image_path: string | null; image_mime: string | null }
    | undefined;
  if (!row?.image_mime) return undefined;
  if (row.image_data) return { bytes: new Uint8Array(row.image_data), mime: row.image_mime };
  try {
    return row.image_path ? { bytes: new Uint8Array(readFileSync(row.image_path)), mime: row.image_mime } : undefined;
  } catch {
    return undefined;
  }
}

export async function claimsForOrder(orderId: string): Promise<ClaimRow[]> {
  return await getDb().all(`SELECT ${CLAIM_COLUMNS} FROM claims WHERE order_id = ? ORDER BY created_at DESC`, orderId) as ClaimRow[];
}

// Limits for a public demo: each claim spends Channel3 and AI calls on the store's keys. The per-visitor
// limit comes first, so one sender cannot use up the shared budget for everyone else.
const MAX_CLAIMS_PER_ORDER = 10;
const MAX_CLAIMS_PER_CLIENT_PER_MINUTE = 6;
const MAX_CLAIMS_PER_MINUTE = 30;

/** Who is filing, for the per-visitor limit: a hash of the sender's IP address. */
export type FileOptions = { client?: string };

async function assertClaimBudget(orderId: string, client?: string) {
  const db = getDb();
  const perOrder = (await db.get("SELECT COUNT(*) AS n FROM claims WHERE order_id = ?", orderId)) as { n: number | string };
  if (Number(perOrder.n) >= MAX_CLAIMS_PER_ORDER) throw new InvariantError(429, "This order has reached its limit of price-match claims.");
  const since = new Date(Date.now() - 60_000).toISOString();
  if (client) {
    const mine = (await db.get("SELECT COUNT(*) AS n FROM claims WHERE client_hash = ? AND created_at > ?", client, since)) as { n: number | string };
    if (Number(mine.n) >= MAX_CLAIMS_PER_CLIENT_PER_MINUTE) throw new InvariantError(429, "You have sent several claims in a short time. Try again in a minute.");
  }
  const recent = (await db.get("SELECT COUNT(*) AS n FROM claims WHERE created_at > ?", since)) as { n: number | string };
  if (Number(recent.n) >= MAX_CLAIMS_PER_MINUTE) throw new InvariantError(429, "Matchback is busy right now. Try again in a minute.");
}

/** File a claim. Checks run before anything is stored or any provider is called. */
export async function fileClaim(orderId: string, competitorUrl: string, locale: Locale = "en", opts: FileOptions = {}): Promise<ClaimRow> {
  const order = await getOrderRow(orderId);
  if (!order || order.status !== "captured") throw new InvariantError(409, "Price-match claims are for paid orders only.");
  await assertClaimBudget(orderId, opts.client);
  let url: URL;
  try {
    url = new URL(competitorUrl.trim());
  } catch {
    throw new InvariantError(400, "Paste the full link to the competitor's product page.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new InvariantError(400, "Only web links are accepted.");
  const id = randomUUID();
  await getDb().run("INSERT INTO claims (id, order_id, competitor_url, status, created_at, locale, client_hash) VALUES (?, ?, ?, 'verifying', ?, ?, ?)", id, orderId, url.toString(), now(), locale, opts.client ?? null);
  return (await getClaim(id))!;
}

/** File a claim from a price-watch finding: the offer is already known by store, on the product's own record. */
export async function fileWatchClaim(orderId: string, offerUrl: string, domain: string, locale: Locale = "en", opts: FileOptions = {}): Promise<ClaimRow> {
  const order = await getOrderRow(orderId);
  if (!order || order.status !== "captured") throw new InvariantError(409, "Price-match claims are for paid orders only.");
  await assertClaimBudget(orderId, opts.client);
  const id = randomUUID();
  await getDb().run("INSERT INTO claims (id, order_id, competitor_url, status, created_at, source, competitor_domain, locale, client_hash) VALUES (?, ?, ?, 'verifying', ?, 'watch', ?, ?, ?)", id, orderId, offerUrl, now(), domain, locale, opts.client ?? null);
  return (await getClaim(id))!;
}

export const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** PNG, JPEG or WebP, recognised by the file's signature bytes; null for anything else. */
export function imageTypeOf(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** File a claim from a screenshot or photo of the cheaper offer. */
export async function fileImageClaim(orderId: string, image: { bytes: Uint8Array; mime: string }, locale: Locale = "en", opts: FileOptions = {}): Promise<ClaimRow> {
  const order = await getOrderRow(orderId);
  if (!order || order.status !== "captured") throw new InvariantError(409, "Price-match claims are for paid orders only.");
  await assertClaimBudget(orderId, opts.client);
  if (image.bytes.byteLength === 0 || image.bytes.byteLength > MAX_IMAGE_BYTES) throw new InvariantError(413, "The image must be under 5 MB.");
  // The type comes from the file's own bytes, not from what the browser declared.
  const mime = imageTypeOf(image.bytes);
  if (!mime) throw new InvariantError(415, "Upload a PNG, JPEG or WebP image.");
  const id = randomUUID();
  await getDb().run("INSERT INTO claims (id, order_id, competitor_url, status, created_at, source, image_data, image_mime, locale, client_hash) VALUES (?, ?, ?, 'verifying', ?, 'image', ?, ?, ?, ?)", id, orderId, `upload:${id}`, now(), image.bytes, mime, locale, opts.client ?? null);
  return (await getClaim(id))!;
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
  // The brand's own store counts as a competitor; the brand comes from our side, never the listing.
  let knownRetailer = isKnownRetailer(domain, input.purchasedTitle);
  if (!knownRetailer && !isResaleDomain(domain)) {
    try {
      knownRetailer = isKnownRetailer(domain, input.purchasedTitle, ((await deps.channel3.product(input.purchasedProductId)).brands ?? []).map((b) => b.name));
    } catch {
      // keep false: the claim goes to a person
    }
  }
  const base = { paidCents: input.paidCents, currency: input.currency, capturedAt: input.capturedAt, now: deps.now(), competitorDomain: domain, settings: deps.settings, knownRetailer };

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
      storeTitle: input.purchasedTitle,
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
  const stored = await getClaimImage(claim.id);
  if (!stored) throw new InvariantError(404, "The screenshot for this claim is missing.");
  const bytes = stored.bytes;
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
  await db.run("UPDATE claims SET competitor_url = ?, competitor_domain = ? WHERE id = ?", offer?.url ?? `https://${resolution.domain}/`, resolution.domain, claim.id);
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
  // The listing may be the purchased product's own (matched by store); the image itself must show
  // that product too, or a screenshot of anything at that store would qualify.
  const shows = imageMatchesPurchase(ex, claimInput.purchasedTitle);
  if (!shows.ok) {
    evidence.decision.checks.push({
      id: "image_product",
      label: "Same product in your image",
      outcome: "review",
      detail: `Your image shows "${shows.shown || "an unreadable product"}", which does not look like the ${claimInput.purchasedTitle} you bought. A person will check it.`,
    });
  }
  evidence.decision.status = statusFrom(evidence.decision.checks);
  if (evidence.decision.status !== "approved") evidence.decision.refundCents = 0;
  evidence.image = { extraction: ex, provider: reading.provider, matchedBy: resolution.matchedBy };
  return evidence;
}

/** Verify a filed claim and, when approved, refund the difference on the PayPal capture. */
export async function verifyClaim(claimId: string, deps: VerifyDeps = defaultDeps()): Promise<ClaimRow> {
  const db = getDb();
  const claim = await getClaim(claimId);
  if (!claim) throw new InvariantError(404, "Unknown claim.");
  if (claim.status !== "verifying") return claim;
  const order = (await getOrderRow(claim.order_id))!;
  const product = await db.get("SELECT title FROM catalog WHERE product_id = ?", order.product_id) as { title: string };

  const claimInput = {
    purchasedProductId: order.product_id,
    purchasedTitle: product.title,
    paidCents: order.captured_cents ?? order.amount_cents,
    currency: order.currency,
    capturedAt: order.captured_at ?? (await db.get("SELECT created_at FROM orders WHERE id = ?", order.id) as { created_at: string }).created_at,
    competitorUrl: claim.competitor_url,
  };

  let evidence: ClaimEvidence;
  if (claim.source === "image") {
    evidence = await evaluateImageClaim(claim, claimInput, deps);
  } else if (claim.source === "watch") {
    // Re-read the product record now, so the refund uses today's offer, not the one seen when it was found.
    const product = await deps.channel3.product(order.product_id);
    evidence = await evaluateClaim({ ...claimInput, resolved: { product, domain: claim.competitor_domain! } }, deps);
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
      locale: claim.locale,
    },
    { ...(deps.providers ? { providers: deps.providers } : {}), ...(deps.llmFetch ? { fetch: deps.llmFetch } : {}) },
  );

  if (evidence.decision.status !== "approved") {
    await saveClaim(claimId, evidence.decision.status, evidence);
    return (await getClaim(claimId))!;
  }
  return payClaim(claim, evidence, evidence.decision.refundCents, deps.refund);
}

async function saveClaim(claimId: string, status: ClaimStatus, evidence: ClaimEvidence, extra: { refund_id?: string; error?: string } = {}) {
  await getDb().run("UPDATE claims SET status = ?, decision_json = ?, refund_id = COALESCE(?, refund_id), error = ?, decided_at = ? WHERE id = ?", status, JSON.stringify(evidence), extra.refund_id ?? null, extra.error ?? null, now(), claimId);
}

/** Refund an approved claim on the PayPal capture and record the outcome. */
async function payClaim(claim: ClaimRow, evidence: ClaimEvidence, amountCents: number, refund: typeof issuePriceMatchRefund): Promise<ClaimRow> {
  await saveClaim(claim.id, "approved", evidence);
  try {
    const result = await refund({
      claimId: claim.id,
      orderId: claim.order_id,
      amountCents,
      retailer: evidence.competitor?.domain ?? claim.competitor_domain ?? "a competing retailer",
    });
    await saveClaim(claim.id, "refunded", evidence, { refund_id: result.refundId });
  } catch (err) {
    // The explanation was written expecting a refund; when the refund does not go through, say so.
    evidence.explanation = {
      source: "template",
      text: refundProblemText(
        claim.locale,
        amountCents,
        err instanceof OutcomeUnknownError ? "unknown"
          : { reason: err instanceof PaypalRefusedError ? friendlyRefusal(err.issue) : err instanceof InvariantError ? err.message : "please contact the store." },
      ),
    };
    if (err instanceof OutcomeUnknownError) await saveClaim(claim.id, "refund_unknown", evidence, { error: "Refund outcome unknown; checking with PayPal." });
    else if (err instanceof PaypalRefusedError) await saveClaim(claim.id, "refund_failed", evidence, { error: friendlyRefusal(err.issue) });
    else if (err instanceof InvariantError) await saveClaim(claim.id, "refund_failed", evidence, { error: err.message });
    else await saveClaim(claim.id, "refund_failed", evidence, { error: "Refund could not be completed." });
  }
  return (await getClaim(claim.id))!;
}

/**
 * The offer's price as a reviewer should see it. For a screenshot whose search found another product,
 * that listing's price says nothing about the shopper's offer: use the price read from the image.
 */
export function offerCentsOf(evidence: ClaimEvidence | null): number | null {
  if (!evidence) return null;
  const imageCents = evidence.image?.extraction?.priceCents ?? null;
  const identityOk = evidence.decision.checks.some((c) => c.id === "identity" && c.outcome === "pass");
  if (evidence.image && !identityOk) return imageCents;
  return evidence.decision.competitorCents ?? imageCents;
}

/** What a reviewer is offered by default: the gap to the offer's price. */
export function suggestedRefundCents(evidence: ClaimEvidence | null, paidCents: number): number | null {
  const offerCents = offerCentsOf(evidence);
  return offerCents !== null && offerCents < paidCents ? paidCents - offerCents : null;
}

/** True when the order already has its one price-match refund (any state but a released claim). */
export async function orderRefunded(orderId: string): Promise<boolean> {
  return !!(await getDb().get("SELECT 1 AS x FROM refunds WHERE order_id = ? AND kind = 'price_match'", orderId));
}

async function takeForReview(claimId: string, next: ClaimStatus): Promise<{ claim: ClaimRow; evidence: ClaimEvidence }> {
  const claim = await getClaim(claimId);
  if (!claim) throw new InvariantError(404, "Unknown claim.");
  // Only one reviewer decision per claim: the status moves atomically out of needs_review.
  const { changes } = await getDb().run("UPDATE claims SET status = ? WHERE id = ? AND status = 'needs_review'", next, claimId);
  if (changes !== 1) throw new InvariantError(409, "This claim is not waiting for review any more.");
  const evidence = JSON.parse(claim.decision_json ?? "null") as ClaimEvidence | null;
  if (!evidence) throw new InvariantError(409, "This claim has no recorded decision.");
  return { claim, evidence };
}

/** A reviewer approves a claim the verifier sent to a person: refund the given amount through PayPal. */
export async function approveReviewedClaim(claimId: string, amountCents: number, note: string, refund: typeof issuePriceMatchRefund = issuePriceMatchRefund): Promise<ClaimRow> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new InvariantError(400, "Enter a refund amount above $0.00.");
  // The refund re-checks every limit; checking the cap first keeps a typo from closing the review.
  const pending = await getClaim(claimId);
  const order = pending ? await getOrderRow(pending.order_id) : undefined;
  if (order?.captured_cents && amountCents > Math.floor(order.captured_cents * maxRefundShare())) {
    throw new InvariantError(400, `The most this store refunds on one order is ${Math.round(maxRefundShare() * 100)}% of the price paid.`);
  }
  if (pending && (await orderRefunded(pending.order_id))) throw new InvariantError(409, "This order already received its price-match refund.");
  const { claim, evidence } = await takeForReview(claimId, "approved");
  const text = note.trim().slice(0, 300);
  evidence.review = { outcome: "approved", note: text, amountCents, at: now() };
  evidence.decision.refundCents = amountCents;
  evidence.explanation = { source: "template", text: reviewText(claim.locale, { approvedCents: amountCents }, text) };
  return payClaim(claim, evidence, amountCents, refund);
}

/** A reviewer refuses a claim the verifier sent to a person. */
export async function refuseReviewedClaim(claimId: string, note: string): Promise<ClaimRow> {
  const { claim, evidence } = await takeForReview(claimId, "refused");
  const text = note.trim().slice(0, 300);
  evidence.review = { outcome: "refused", note: text, amountCents: null, at: now() };
  evidence.decision.refundCents = 0;
  evidence.explanation = { source: "template", text: reviewText(claim.locale, { refused: true }, text) };
  await saveClaim(claim.id, "refused", evidence);
  return (await getClaim(claim.id))!;
}

// Claims a crashed or timed-out run left behind: still being checked, approved but never refunded, or
// refunded with an unknown outcome. The receipt page and the daily job retry them.
const STALE_MS = 5 * 60_000;
const UNFINISHED: ClaimStatus[] = ["verifying", "approved", "refund_unknown"];

export function isStale(claim: Pick<ClaimRow, "status" | "created_at" | "decided_at">, nowMs = Date.now()): boolean {
  if (!UNFINISHED.includes(claim.status)) return false;
  const since = claim.status === "verifying" ? claim.created_at : (claim.decided_at ?? claim.created_at);
  return nowMs - Date.parse(since) > STALE_MS;
}

/** Retry one stale claim. A lease in the database keeps two server instances from retrying it at once. */
export async function reconcileClaim(claimId: string, deps: VerifyDeps = defaultDeps(), nowMs = Date.now()): Promise<ClaimRow | undefined> {
  const claim = await getClaim(claimId);
  if (!claim || !isStale(claim, nowMs)) return claim;
  const cutoff = new Date(nowMs - STALE_MS).toISOString();
  const { changes } = await getDb().run(
    "UPDATE claims SET retry_at = ? WHERE id = ? AND status = ? AND (retry_at IS NULL OR retry_at < ?)",
    new Date(nowMs).toISOString(), claimId, claim.status, cutoff,
  );
  if (changes !== 1) return claim;
  if (claim.status === "verifying") return verifyClaim(claimId, deps);
  const evidence = JSON.parse(claim.decision_json ?? "null") as ClaimEvidence | null;
  if (!evidence || evidence.decision.refundCents <= 0) return claim;
  // The refund is guarded by its PayPal write claim: a refund that did go out is found and recorded, never sent twice.
  const result = await payClaim(claim, evidence, evidence.decision.refundCents, deps.refund);
  if (result.status === "refunded" && claim.status === "refund_unknown") {
    evidence.explanation = { source: "template", text: refundDoneText(claim.locale, evidence.decision.refundCents) };
    await saveClaim(claim.id, "refunded", evidence, { refund_id: result.refund_id ?? undefined });
    return (await getClaim(claim.id))!;
  }
  return result;
}

/** Retry every stale claim (the daily job). */
export async function reconcileStaleClaims(deps: VerifyDeps = defaultDeps(), nowMs = Date.now()): Promise<{ id: string; status: ClaimStatus | undefined }[]> {
  const rows = (await getDb().all(`SELECT ${CLAIM_COLUMNS} FROM claims WHERE status IN ('verifying', 'approved', 'refund_unknown')`)) as ClaimRow[];
  const out: { id: string; status: ClaimStatus | undefined }[] = [];
  for (const row of rows.filter((r) => isStale(r, nowMs))) {
    try {
      out.push({ id: row.id, status: (await reconcileClaim(row.id, deps, nowMs))?.status });
    } catch (err) {
      console.error("claim retry failed", row.id, err);
      out.push({ id: row.id, status: row.status });
    }
  }
  return out;
}
