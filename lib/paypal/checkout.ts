import { randomUUID } from "node:crypto";
import { CheckoutPaymentIntent, type Order } from "paypal";
import { getDb, now } from "@/lib/db";
import { fromCents, toCents } from "@/lib/money";
import { getPaypalClient } from "./client";
import { finishClaim, markUnknown, releaseClaim, takeClaim } from "./claims";
import {
  InvariantError,
  OutcomeUnknownError,
  PaypalIntegrationError,
  PaypalRefusedError,
  isUnknownOutcome,
  issueFrom,
  reasonFrom,
  wasNeverSent,
} from "./errors";

export type OrderRow = {
  id: string;
  product_id: string;
  amount_cents: number;
  currency: string;
  paypal_order_id: string | null;
  capture_id: string | null;
  captured_cents: number | null;
  captured_at: string | null;
  status: string;
  created_at: string;
};

type CatalogRow = { product_id: string; title: string; price_cents: number; currency: string };

export function getOrderRow(id: string): OrderRow | undefined {
  return getDb().prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
}

/** A Matchback order for one catalog product. The amount always comes from the catalog, never the browser. */
export function createOrderRow(productId: string): OrderRow {
  const db = getDb();
  const product = db.prepare("SELECT * FROM catalog WHERE product_id = ?").get(productId) as CatalogRow | undefined;
  if (!product) throw new InvariantError(404, "Unknown product.");
  const id = randomUUID();
  db.prepare("INSERT INTO orders (id, product_id, amount_cents, currency, status, created_at) VALUES (?, ?, ?, ?, 'new', ?)")
    .run(id, productId, product.price_cents, product.currency, now());
  return getOrderRow(id)!;
}

export type CreatedCheckout = { paypalOrderId: string; approveUrl: string };

/** createOrder, guarded by the claim "create:<orderId>". */
export async function createCheckoutOrder(orderId: string, appBaseUrl: string): Promise<CreatedCheckout> {
  const db = getDb();
  const order = getOrderRow(orderId);
  if (!order || (order.status !== "new" && order.status !== "awaiting_approval")) {
    throw new InvariantError(409, "This order cannot be paid.");
  }
  const product = db.prepare("SELECT title FROM catalog WHERE product_id = ?").get(order.product_id) as { title: string };

  const claimKey = `create:${orderId}`;
  const request = {
    payPalRequestId: claimKey,
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          customId: orderId,
          description: product.title.slice(0, 127),
          amount: { currencyCode: order.currency, value: fromCents(order.amount_cents) },
        },
      ],
      paymentSource: {
        paypal: {
          experienceContext: {
            returnUrl: `${appBaseUrl}/checkout/return?order=${encodeURIComponent(orderId)}`,
            cancelUrl: `${appBaseUrl}/?cancelled=1`,
          },
        },
      },
    },
  };

  const existing = takeClaim(claimKey, "createOrder");
  if (existing?.state === "done") return JSON.parse(existing.result_json!) as CreatedCheckout;

  const client = getPaypalClient();
  const record = (created: Order): CreatedCheckout => {
    const approveUrl = created.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    if (!created.id || !approveUrl) throw new OutcomeUnknownError(claimKey);
    const result = { paypalOrderId: created.id, approveUrl };
    db.prepare("UPDATE orders SET paypal_order_id = ?, status = 'awaiting_approval' WHERE id = ?").run(created.id, orderId);
    finishClaim(claimKey, result);
    return result;
  };

  // Settle an unknown outcome: PayPal returns the existing order for a repeated PayPal-Request-Id
  // (verified against the sandbox 2026-10-29), so the re-send finds the order rather than duplicating it.
  const settle = async (cause: unknown): Promise<CreatedCheckout> => {
    try {
      const again = await client.orders.createOrder(request, { retry: { maxRetries: 0 } }).asApiResult();
      if (again.ok) return record(again.value);
    } catch {
      // fall through: still unknown
    }
    markUnknown(claimKey);
    throw new OutcomeUnknownError(claimKey, { cause });
  };

  if (existing) return settle(new Error(`claim ${claimKey} is ${existing.state}`));

  try {
    const result = await client.orders.createOrder(request).asApiResult();
    if (result.ok) return record(result.value);
    if (result.status >= 500) return settle(new Error(`createOrder answered ${result.status}`));
    releaseClaim(claimKey);
    const body = "body" in result.payload ? result.payload.body : undefined;
    throw new PaypalRefusedError(result.status, reasonFrom(body), body?.debugId, issueFrom(body));
  } catch (err) {
    if (err instanceof PaypalRefusedError || err instanceof OutcomeUnknownError) throw err;
    if (wasNeverSent(err)) {
      releaseClaim(claimKey);
      throw new PaypalIntegrationError("createOrder was not sent", { cause: err });
    }
    if (isUnknownOutcome(err)) return settle(err);
    releaseClaim(claimKey);
    throw err;
  }
}

export type CaptureResult = { orderId: string; captureId: string; capturedCents: number; currency: string; status: string };

/** captureOrder after the buyer approved, guarded by the claim "capture:<paypalOrderId>". */
export async function captureCheckoutOrder(orderId: string): Promise<CaptureResult> {
  const db = getDb();
  const order = getOrderRow(orderId);
  // Invariant: only an order this app created and sent to PayPal can be captured.
  if (!order?.paypal_order_id) throw new InvariantError(404, "Unknown order.");
  if (order.status === "captured") {
    return { orderId, captureId: order.capture_id!, capturedCents: order.captured_cents!, currency: order.currency, status: "COMPLETED" };
  }
  if (order.status !== "awaiting_approval" && order.status !== "capture_unknown") throw new InvariantError(409, "This order cannot be captured.");

  const paypalOrderId = order.paypal_order_id;
  const claimKey = `capture:${paypalOrderId}`;
  const client = getPaypalClient();

  const record = (o: Order): CaptureResult | undefined => {
    const capture = o.purchaseUnits?.[0]?.payments?.captures?.[0];
    if (o.status !== "COMPLETED" || !capture?.id || !capture.amount?.value || !capture.status) return undefined;
    const result = {
      orderId,
      captureId: capture.id,
      capturedCents: toCents(capture.amount.value),
      currency: capture.amount.currencyCode,
      status: capture.status,
    };
    db.prepare("UPDATE orders SET capture_id = ?, captured_cents = ?, status = 'captured', captured_at = COALESCE(captured_at, ?) WHERE id = ?")
      .run(result.captureId, result.capturedCents, o.purchaseUnits?.[0]?.payments?.captures?.[0]?.createTime ?? now(), orderId);
    finishClaim(claimKey, result);
    return result;
  };

  // Settle an unknown outcome by re-reading the order.
  const settle = async (cause: unknown): Promise<CaptureResult> => {
    try {
      const read = await client.orders.getOrder({ id: paypalOrderId });
      const settled = record(read);
      if (settled) return settled;
    } catch {
      // fall through: still unknown
    }
    markUnknown(claimKey);
    db.prepare("UPDATE orders SET status = 'capture_unknown' WHERE id = ?").run(orderId);
    throw new OutcomeUnknownError(claimKey, { cause });
  };

  const existing = takeClaim(claimKey, "captureOrder");
  if (existing?.state === "done") return JSON.parse(existing.result_json!) as CaptureResult;
  if (existing) return settle(new Error(`claim ${claimKey} is ${existing.state}`));

  try {
    const result = await client.orders
      // An empty body, not an omitted one: without a body the SDK sends no Content-Type, and the
      // sandbox refuses that with 415 "The request payload is not supported" (observed 2026-10-29).
      .captureOrder({ id: paypalOrderId, payPalRequestId: claimKey, prefer: "return=representation", body: {} })
      .asApiResult();
    if (result.ok) return record(result.value) ?? settle(new Error("capture response missing capture fields"));
    if (result.status >= 500) return settle(new Error(`captureOrder answered ${result.status}`));
    releaseClaim(claimKey);
    const body = "body" in result.payload ? result.payload.body : undefined;
    throw new PaypalRefusedError(result.status, reasonFrom(body), body?.debugId, issueFrom(body));
  } catch (err) {
    if (err instanceof PaypalRefusedError || err instanceof OutcomeUnknownError) throw err;
    if (wasNeverSent(err)) {
      releaseClaim(claimKey);
      throw new PaypalIntegrationError("captureOrder was not sent", { cause: err });
    }
    if (isUnknownOutcome(err)) return settle(err);
    releaseClaim(claimKey);
    throw err;
  }
}
