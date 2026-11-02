import type { Refund } from "paypal";
import { getDb, isDuplicateKey, now } from "@/lib/db";
import { fromCents, toCents } from "@/lib/money";
import { loadStoreSettings } from "@/lib/store-settings";
import { getPaypalClient } from "./client";
import { getOrderRow } from "./checkout";
import { finishClaim, markUnknown, releaseClaim, takeClaim } from "./claims";
import {
  InvariantError,
  OutcomeUnknownError,
  PaypalIntegrationError,
  PaypalRefusedError,
  PaypalUnavailableError,
  isUnknownOutcome,
  issueFrom,
  reasonFrom,
  wasNeverSent,
} from "./errors";

/** Largest share of the captured amount a single price-match refund may return. Merchant setting. */
export async function maxRefundShare(): Promise<number> {
  const v = (await loadStoreSettings()).maxRefundShare;
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.5;
}

export type RefundRequestInput = { claimId: string; orderId: string; amountCents: number; retailer: string };
export type RefundResult = { claimId: string; refundId: string; status: string; amountCents: number; currency: string };

type RefundRow = { claim_id: string; refund_id: string | null; status: string; amount_cents: number; currency: string };

async function refundedSoFar(captureId: string): Promise<number> {
  const row = await getDb().get("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM refunds WHERE capture_id = ? AND status != 'claimed'", captureId) as { total: number | string };
  return Number(row.total); // Postgres returns SUM() as a string
}

/** refundCapturedPayment for an approved price-match claim, guarded by the claim "refund:<claimId>". */
export async function issuePriceMatchRefund(input: RefundRequestInput): Promise<RefundResult> {
  const db = getDb();
  const { claimId, orderId, amountCents, retailer } = input;

  // Invariants (paypal-plan.md 1b.2), checked before any claim exists.
  const order = await getOrderRow(orderId);
  if (!order || order.status !== "captured" || !order.capture_id || order.captured_cents === null || !order.paypal_order_id) {
    throw new InvariantError(409, "Only a captured Matchback order can be refunded.");
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new InvariantError(400, "Refund amount must be positive.");
  const remaining = order.captured_cents - (await refundedSoFar(order.capture_id));
  if (amountCents > remaining) throw new InvariantError(400, "Refund exceeds what is left on this payment.");
  if (amountCents > Math.floor(order.captured_cents * (await maxRefundShare()))) {
    throw new InvariantError(400, "Refund exceeds the merchant's price-match cap.");
  }

  const claimKey = `refund:${claimId}`;
  const captureId = order.capture_id;
  const paypalOrderId = order.paypal_order_id;
  const currency = order.currency;

  const existing = await takeClaim(claimKey, "refundCapturedPayment");
  if (existing?.state === "done") return JSON.parse(existing.result_json!) as RefundResult;

  if (!existing) {
    try {
      await db.run("INSERT INTO refunds (claim_id, order_id, capture_id, kind, amount_cents, currency, status, created_at) VALUES (?, ?, ?, 'price_match', ?, ?, 'claimed', ?)", claimId, orderId, captureId, amountCents, currency, now());
    } catch (err) {
      await releaseClaim(claimKey);
      if (isDuplicateKey(err)) throw new InvariantError(409, "This order already received a price-match refund.");
      throw err;
    }
  }

  const client = getPaypalClient();
  const record = async (r: Refund): Promise<RefundResult> => {
    if (!r.id || !r.status) throw new OutcomeUnknownError(claimKey);
    const result = { claimId, refundId: r.id, status: r.status, amountCents, currency };
    await db.run("UPDATE refunds SET refund_id = ?, status = ? WHERE claim_id = ?", r.id, r.status.toLowerCase(), claimId);
    await finishClaim(claimKey, result);
    return result;
  };
  const release = async () => {
    await db.run("DELETE FROM refunds WHERE claim_id = ?", claimId);
    await releaseClaim(claimKey);
  };

  // Settle an unknown outcome: look for a refund carrying our custom_id on the order.
  const settle = async (cause: unknown): Promise<RefundResult> => {
    try {
      const read = await client.orders.getOrder({ id: paypalOrderId });
      const found = read.purchaseUnits?.flatMap((pu) => pu.payments?.refunds ?? []).find((r) => r.customId === claimId);
      if (found) return await record(found);
    } catch {
      // fall through: still unknown
    }
    await markUnknown(claimKey);
    await db.run("UPDATE refunds SET status = 'unknown' WHERE claim_id = ?", claimId);
    throw new OutcomeUnknownError(claimKey, { cause });
  };

  if (existing) return settle(new Error(`claim ${claimKey} is ${existing.state}`));

  try {
    const result = await client.payments
      .refundCapturedPayment({
        captureId,
        payPalRequestId: claimKey,
        body: {
          amount: { currencyCode: currency, value: fromCents(amountCents) },
          customId: claimId,
          noteToPayer: `Price match: lower price verified at ${retailer}`.slice(0, 255),
        },
      })
      .asApiResult();
    if (result.ok) return await record(result.value);
    if (result.status >= 500) return settle(new Error(`refundCapturedPayment answered ${result.status}`));
    await release();
    const body = "body" in result.payload ? result.payload.body : undefined;
    throw new PaypalRefusedError(result.status, reasonFrom(body), body?.debugId, issueFrom(body));
  } catch (err) {
    if (err instanceof PaypalRefusedError || err instanceof OutcomeUnknownError) throw err;
    if (wasNeverSent(err)) {
      await release();
      throw new PaypalIntegrationError("refundCapturedPayment was not sent", { cause: err });
    }
    if (isUnknownOutcome(err)) return settle(err);
    await release();
    throw err;
  }
}

export type RefundReadBack = {
  refundId: string;
  status: string | undefined;
  amount: string | undefined;
  currency: string | undefined;
  customIdMatches: boolean;
  captureStatus: string | undefined;
};

/** Independent read-back through different calls than the one that wrote: getRefund + getCapturedPayment. */
export async function readBackRefund(claimId: string): Promise<RefundReadBack> {
  const db = getDb();
  const row = await db.get("SELECT r.*, o.capture_id AS cap FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.claim_id = ?", claimId) as
    | (RefundRow & { cap: string })
    | undefined;
  if (!row?.refund_id) throw new InvariantError(404, "No refund recorded for this claim.");
  const client = getPaypalClient();
  try {
    const [refund, capture] = await Promise.all([
      client.payments.getRefund({ refundId: row.refund_id }),
      client.payments.getCapturedPayment({ captureId: row.cap }),
    ]);
    return {
      refundId: row.refund_id,
      status: refund.status,
      amount: refund.amount?.value,
      currency: refund.amount?.currencyCode,
      customIdMatches: refund.customId === claimId,
      captureStatus: capture.status,
    };
  } catch (err) {
    if (wasNeverSent(err)) throw new PaypalIntegrationError("read-back was not sent", { cause: err });
    throw new PaypalUnavailableError("read-back failed", { cause: err });
  }
}

export { toCents };
