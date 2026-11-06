import { getDb } from "@/lib/db";
import { LOCALES, type Locale } from "@/lib/i18n";
import { fromCents } from "@/lib/money";
import { getOrderRow } from "@/lib/paypal/checkout";
import { InvariantError } from "@/lib/paypal/errors";
import { loadStoreSettings } from "@/lib/store-settings";
import { KNOWN_RETAILERS } from "@/lib/verifier/retailers";
import { claimsForOrder, fileClaim, getClaim, orderRefunded, type ClaimEvidence, type ClaimRow } from "@/lib/verifier/run";

// Matchback for AI agents: a Model Context Protocol server (Streamable HTTP, JSON responses, no session).
// A shopper's own assistant can read the store's price-match policy, look up the shopper's order, file a
// claim with a link to the cheaper offer and follow it. A claim filed here takes the same path as one filed
// on the order page: the same checks, the same per-order and per-visitor limits, the store owner's
// automatic-payment limits, and a person for anything uncertain. The agent never chooses an amount.
//
// The order id is the private id on the shopper's order page; holding it is what lets the order page file
// a claim too. Nothing here changes store settings, approves a reviewed claim or moves money directly.

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL = "2025-06-18";
const SERVER_INFO = { name: "matchback", title: "Matchback price match", version: "1.0.0" };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type McpContext = {
  /** Public address of the app, for the order and receipt links returned to the agent. */
  origin: string;
  /** Hash of the caller's IP address, for the per-visitor claim limit. */
  client?: string;
  /** Runs the verification of a filed claim (the route passes verifyClaim). */
  verify: (claimId: string) => Promise<ClaimRow>;
  /** Keeps a verification running after the response when it outlasts the wait (the route passes after()). */
  background?: (work: Promise<unknown>) => void;
  /** How long file_price_match_claim waits for a decision before answering "verifying". */
  waitMs?: number;
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RpcId = string | number | null;
type RpcResponse = { jsonrpc: "2.0"; id: RpcId; result?: unknown; error?: { code: number; message: string } };
type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: { [key: string]: Json }; isError?: boolean };

const orderIdSchema = { type: "string", description: "The private order id shown on the shopper's Matchback order page (a UUID)." };
const languageSchema = { type: "string", enum: [...LOCALES], description: "Language of the shopper's note: en, fr or es. Default en." };

export const TOOLS = [
  {
    name: "get_price_match_policy",
    title: "Price-match policy",
    description:
      "The store's price-match guarantee: claim window, smallest price difference, which stores count, what is refused, " +
      "and how much is paid automatically before a person decides. Read it before filing a claim.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_order",
    title: "Look up an order",
    description:
      "A paid Matchback order: product, amount paid, when the claim window closes, whether a price-match refund was already " +
      "paid, and its claims. Use only an order id the shopper gave you.",
    inputSchema: { type: "object", properties: { order_id: orderIdSchema }, required: ["order_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "file_price_match_claim",
    title: "File a price-match claim",
    description:
      "File a price-match claim for the shopper's order with a link to the same product sold cheaper at another store. " +
      "Matchback reads the live listing, runs every check of the guarantee and, when all pass and the amount is within the " +
      "store's automatic limit, refunds the difference through PayPal on the original payment. Uncertain claims go to a person " +
      "at the store. The refund amount comes from the live listing; you cannot set it. Ask the shopper before filing.",
    inputSchema: {
      type: "object",
      properties: {
        order_id: orderIdSchema,
        competitor_url: { type: "string", description: "Full link (https://...) to the competitor's product page with the lower price." },
        language: languageSchema,
      },
      required: ["order_id", "competitor_url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "get_claim",
    title: "Follow a claim",
    description: "Status of a price-match claim: decision, every check with its outcome, the refund paid, and the shopper's receipt link.",
    inputSchema: {
      type: "object",
      properties: { claim_id: { type: "string", description: "The claim id returned by file_price_match_claim or get_order." } },
      required: ["claim_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
] as const;

/** Largest batch answered. Batches are an older protocol feature (removed in 2025-06-18), kept for older clients. */
export const MAX_BATCH = 10;

/** Handle one JSON-RPC message or a batch. Returns null when nothing is to be sent back (notifications only). */
export async function handleMcp(message: unknown, ctx: McpContext): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(message)) {
    if (message.length === 0) return rpcError(null, -32600, "Empty batch.");
    if (message.length > MAX_BATCH) return rpcError(null, -32600, `At most ${MAX_BATCH} messages in one batch.`);
    // Claims filed in the same moment would all pass the per-visitor and per-order limits before any of them
    // is stored, so a batch files one claim; the others are answered with an error and never reach Channel3.
    let filings = 0;
    const replies = (await Promise.all(message.map((m) =>
      filesClaim(m) && ++filings > 1 ? rpcError(idOf(m), -32600, "File one claim per request.") : handleOne(m, ctx),
    ))).filter((r): r is RpcResponse => r !== null);
    return replies.length ? replies : null;
  }
  return handleOne(message, ctx);
}

function filesClaim(m: unknown): boolean {
  return isObject(m) && "id" in m && m.method === "tools/call" && isObject(m.params) && m.params.name === "file_price_match_claim";
}

function idOf(m: unknown): RpcId {
  return isObject(m) && isRpcId(m.id) ? m.id : null;
}

async function handleOne(message: unknown, ctx: McpContext): Promise<RpcResponse | null> {
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    // A response object from the client, or garbage: nothing to answer for the first, an error for the second.
    if (isObject(message) && message.jsonrpc === "2.0" && ("result" in message || "error" in message)) return null;
    const rawId = isObject(message) ? message.id : null;
    return rpcError(isRpcId(rawId) ? rawId : null, -32600, "Invalid request.");
  }
  const notification = !("id" in message);
  const id: RpcId = isRpcId(message.id) ? message.id : null;
  const params = isObject(message.params) ? message.params : {};
  if (notification) return null; // notifications/initialized, notifications/cancelled: no reply

  switch (message.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return result(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Matchback runs a store's price-match guarantee. Read get_price_match_policy, then get_order with the order id the " +
          "shopper gives you. Ask the shopper before file_price_match_claim. Matchback decides and pays; uncertain claims go to a person.",
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: TOOLS });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${name || "(none)"}.`);
      const args = isObject(params.arguments) ? params.arguments : {};
      return result(id, await callTool(name, args, ctx));
    }
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}.`);
  }
}

async function callTool(name: string, args: Record<string, unknown>, ctx: McpContext): Promise<ToolResult> {
  try {
    switch (name) {
      case "get_price_match_policy":
        return ok(await policy());
      case "get_order":
        return ok(await order(text(args.order_id, "order_id"), ctx));
      case "file_price_match_claim":
        return ok(await fileForAgent(text(args.order_id, "order_id"), text(args.competitor_url, "competitor_url"), language(args.language), ctx));
      case "get_claim":
        return ok(await claimSummary(await knownClaim(text(args.claim_id, "claim_id")), ctx));
    }
    return fail(`Unknown tool: ${name}.`);
  } catch (err) {
    if (err instanceof InvariantError) return fail(err.message);
    console.error("mcp tool failed", name, err);
    return fail("Matchback could not answer right now. Try again in a minute.");
  }
}

async function policy() {
  const s = await loadStoreSettings();
  const money = (c: number | null) => (c === null ? null : `$${fromCents(c)}`);
  return {
    claimWindowDays: s.windowDays,
    smallestDifference: money(s.minDiffCents),
    automaticPaymentLimitPerRefund: money(s.autoRefundLimitCents),
    automaticPaymentLimitPerDay: money(s.dailyAutoLimitCents),
    automaticPaymentNote:
      s.autoRefundLimitCents === null && s.dailyAutoLimitCents === null
        ? "A claim that passes every check is paid automatically."
        : "A claim that passes every check is paid automatically up to these limits; above them a person at the store decides.",
    largestRefund: `${Math.round(s.maxRefundShare * 100)}% of the price paid`,
    storesThatCount: [...KNOWN_RETAILERS, ...s.extraRetailers],
    alsoCounts: "The brand's own store (for example bose.com for a Bose product). Other stores are not refused: a person checks them.",
    refused: [
      "a different model, edition, generation, bundle, accessory or refurbished unit",
      "resale marketplaces",
      "used or refurbished offers",
      "out-of-stock offers",
      "claims outside the claim window",
      "a difference smaller than the smallest difference",
    ],
    suspiciousPrice: `An offer below ${Math.round(s.floorShare * 100)}% of the price paid goes to a person instead of being paid.`,
    refunds: "PayPal refunds the difference on the original payment. One price-match refund per order.",
    decidedBy: "Fixed rules decide. An AI only judges whether the two listings are the same product, and fixed rules can overrule it.",
  };
}

async function order(orderId: string, ctx: McpContext) {
  if (!ID.test(orderId)) throw new InvariantError(400, "That is not a Matchback order id.");
  const row = await getOrderRow(orderId);
  if (!row) throw new InvariantError(404, "No order has that id.");
  const product = await getDb().get("SELECT title FROM catalog WHERE product_id = ?", row.product_id) as { title: string } | undefined;
  const settings = await loadStoreSettings();
  const paid = row.status === "captured";
  const closes = paid && row.captured_at ? new Date(Date.parse(row.captured_at) + settings.windowDays * 86_400_000).toISOString() : null;
  const claims = await claimsForOrder(orderId);
  return {
    orderId,
    product: product?.title ?? row.product_id,
    paid: paid ? `$${fromCents(row.captured_cents ?? row.amount_cents)} ${row.currency}` : null,
    status: paid ? "paid" : "not paid",
    paidAt: paid ? row.captured_at : null,
    claimWindowCloses: closes,
    priceMatchRefundAlreadyPaid: await orderRefunded(orderId),
    claims: claims.map((c) => ({ claimId: c.id, status: c.status, filedAt: c.created_at, competitorUrl: c.competitor_url })),
    orderPage: `${ctx.origin}/orders/${orderId}`,
  };
}

async function fileForAgent(orderId: string, competitorUrl: string, locale: Locale, ctx: McpContext) {
  if (!ID.test(orderId)) throw new InvariantError(400, "That is not a Matchback order id.");
  const claim = await fileClaim(orderId, competitorUrl, locale, { client: ctx.client });
  const verifying = ctx.verify(claim.id);
  const waitMs = ctx.waitMs ?? 45_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    verifying.then(() => true, () => true),
    new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), waitMs); }),
  ]);
  clearTimeout(timer);
  if (!settled) ctx.background?.(verifying);
  return claimSummary(await knownClaim(claim.id), ctx);
}

async function knownClaim(claimId: string): Promise<ClaimRow> {
  if (!ID.test(claimId)) throw new InvariantError(400, "That is not a Matchback claim id.");
  const claim = await getClaim(claimId);
  if (!claim) throw new InvariantError(404, "No claim has that id.");
  return claim;
}

const STATUS_NOTE: Record<ClaimRow["status"], string> = {
  verifying: "Matchback is still checking the offer. Call get_claim again in about 20 seconds.",
  approved: "Approved. The PayPal refund is being sent.",
  refunded: "Refunded through PayPal on the original payment.",
  refused: "Refused. The failed checks say why; the shopper's receipt explains it.",
  needs_review: "Sent to a person at the store, who will approve or refuse it. Nothing has been paid yet.",
  refund_unknown: "Approved, but PayPal's answer was unclear. Matchback reads the refund back from PayPal before showing it as paid.",
  refund_failed: "Approved, but the refund did not go through. The store has been told.",
};

async function claimSummary(claim: ClaimRow, ctx: McpContext) {
  const evidence = claim.decision_json ? JSON.parse(claim.decision_json) as ClaimEvidence : null;
  const refund = await getDb().get("SELECT amount_cents, currency, status FROM refunds WHERE claim_id = ?", claim.id) as
    | { amount_cents: number; currency: string; status: string }
    | undefined;
  return {
    claimId: claim.id,
    orderId: claim.order_id,
    status: claim.status,
    note: STATUS_NOTE[claim.status],
    competitorUrl: claim.competitor_url,
    competitor: evidence?.competitor ? { title: evidence.competitor.title, store: evidence.competitor.domain } : null,
    competitorPrice: evidence?.decision.competitorCents != null ? `$${fromCents(evidence.decision.competitorCents)}` : null,
    refunded: refund && refund.status === "completed" ? `$${fromCents(refund.amount_cents)} ${refund.currency}` : null,
    checks: evidence?.decision.checks.map((c) => ({ check: c.label, outcome: c.outcome, detail: c.detail })) ?? [],
    explanation: evidence?.explanation?.text ?? null,
    storeDecision: evidence?.review ? { outcome: evidence.review.outcome, note: evidence.review.note } : null,
    receipt: `${ctx.origin}/claims/${claim.id}`,
  };
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new InvariantError(400, `${name} is required.`);
  return value.trim();
}

function language(value: unknown): Locale {
  return LOCALES.includes(value as Locale) ? value as Locale : "en";
}

function ok(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data as { [key: string]: Json } };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function result(id: RpcId, value: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result: value };
}

export function rpcError(id: RpcId, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRpcId(v: unknown): v is RpcId {
  return typeof v === "string" || typeof v === "number" || v === null;
}
