import { beforeEach, describe, expect, it } from "vitest";
import { orderSchema, refundSchema, type Order, type Refund } from "paypal";
import { getDb, resetDbForTests } from "@/lib/db";
import { buildPaypalClient, setPaypalClientForTests } from "@/lib/paypal/client";
import { captureCheckoutOrder, createCheckoutOrder, createOrderRow } from "@/lib/paypal/checkout";
import { InvariantError, OutcomeUnknownError, PaypalIntegrationError, PaypalRefusedError, toHttp } from "@/lib/paypal/errors";
import { issuePriceMatchRefund } from "@/lib/paypal/refunds";

// ---- fake fetch (no network) ----

type Call = { url: URL; request: Request; body: string | undefined; claimsAtSend: string[] };

function stubFetch(responder: (url: URL, request: Request) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = request.body === null ? undefined : await request.clone().text();
    // Read the store from inside the fake: proves the claim existed when the request left.
    const claimsAtSend = (getDb().prepare("SELECT claim_key FROM paypal_writes").all() as { claim_key: string }[]).map((r) => r.claim_key);
    const call = { url: new URL(request.url), request, body, claimsAtSend };
    calls.push(call);
    return responder(call.url, request);
  };
  const ops = () => calls.filter((c) => !c.url.pathname.endsWith("/v1/oauth2/token"));
  return { fetch, calls, ops };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const token = () => json(200, { access_token: "T", token_type: "Bearer", expires_in: 3600 });
const orderWire = (o: Order) => orderSchema.encode(o);
const refundWire = (r: Refund) => refundSchema.encode(r);
const paypalError = (name: string, message: string, issue?: string) => ({
  name,
  message,
  debug_id: "dbg123",
  ...(issue ? { details: [{ issue, description: `${issue} description` }] } : {}),
});

/** Routes the token endpoint, then hands every operation request to `ops` in order. */
function client(ops: Array<(url: URL, req: Request) => Response | Promise<Response>>) {
  const queue = [...ops];
  const stub = stubFetch((url, req) => {
    if (url.pathname.endsWith("/v1/oauth2/token")) return token();
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${req.method} ${url.pathname}`);
    return next(url, req);
  });
  setPaypalClientForTests(buildPaypalClient({ fetch: stub.fetch, retry: { maxRetries: 0 } }));
  return stub;
}

// ---- fixtures ----

function seedCatalog() {
  getDb().prepare("INSERT INTO catalog (product_id, title, price_cents, currency) VALUES ('p1', 'Samsung T7 1TB', 27499, 'USD')").run();
}

function seedCapturedOrder(): string {
  const o = createOrderRow("p1");
  getDb().prepare("UPDATE orders SET paypal_order_id = 'PO1', capture_id = 'CAP1', captured_cents = 27499, status = 'captured' WHERE id = ?").run(o.id);
  return o.id;
}

const createdOrder: Order = { id: "PO1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://sandbox.paypal.com/approve/PO1" }] };

beforeEach(() => {
  process.env.PAYPAL_ENV = "sandbox";
  process.env.PAYPAL_CLIENT_ID = "test-id";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  resetDbForTests();
  seedCatalog();
});

// ---- createOrder ----

describe("createCheckoutOrder", () => {
  it("takes the claim before the request leaves and sends only the fields the plan requires", async () => {
    const stub = client([() => json(200, orderWire(createdOrder))]);
    const order = createOrderRow("p1");

    const out = await createCheckoutOrder(order.id, "http://localhost:3000");

    expect(out).toEqual({ paypalOrderId: "PO1", approveUrl: "https://sandbox.paypal.com/approve/PO1" });
    const [call] = stub.ops();
    expect(call!.claimsAtSend).toContain(`create:${order.id}`);
    expect(call!.request.headers.get("paypal-request-id")).toBe(`create:${order.id}`);
    const body = JSON.parse(call!.body!);
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "274.99" }); // from catalog
    expect(body.purchase_units[0].custom_id).toBe(order.id);
    expect(Object.keys(body.purchase_units[0]).sort()).toEqual(["amount", "custom_id", "description"]);
    expect(Object.keys(body).sort()).toEqual(["intent", "payment_source", "purchase_units"]);
    // No header set by Matchback beyond PayPal-Request-Id (Prefer is the SDK's own default).
    expect(call!.request.headers.get("paypal-mock-response")).toBeNull();
    expect(call!.request.headers.get("paypal-auth-assertion")).toBeNull();
  });

  it("settles a lost answer by re-sending with the same PayPal-Request-Id", async () => {
    const stub = client([
      () => { throw new Error("ECONNRESET"); },
      () => json(200, orderWire(createdOrder)),
    ]);
    const order = createOrderRow("p1");

    const out = await createCheckoutOrder(order.id, "http://localhost:3000");

    expect(out.paypalOrderId).toBe("PO1");
    const ops = stub.ops();
    expect(ops).toHaveLength(2);
    expect(ops[1]!.request.headers.get("paypal-request-id")).toBe(ops[0]!.request.headers.get("paypal-request-id"));
  });

  it("reports unknown, never failed, when the re-send also gets no answer", async () => {
    client([() => { throw new Error("ECONNRESET"); }, () => { throw new Error("ECONNRESET"); }]);
    const order = createOrderRow("p1");

    await expect(createCheckoutOrder(order.id, "http://localhost:3000")).rejects.toBeInstanceOf(OutcomeUnknownError);
    const row = getDb().prepare("SELECT state FROM paypal_writes WHERE claim_key = ?").get(`create:${order.id}`) as { state: string };
    expect(row.state).toBe("unknown");
  });

  it("makes no re-read when the credential could not be obtained (never sent)", async () => {
    const stub = stubFetch(() => json(401, { error: "invalid_client" }));
    setPaypalClientForTests(buildPaypalClient({ fetch: stub.fetch, retry: { maxRetries: 0 } }));
    const order = createOrderRow("p1");

    await expect(createCheckoutOrder(order.id, "http://localhost:3000")).rejects.toBeInstanceOf(PaypalIntegrationError);
    expect(stub.ops()).toHaveLength(0);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM paypal_writes").get()).toEqual({ n: 0 }); // claim released
  });
});

// ---- captureOrder ----

describe("captureCheckoutOrder", () => {
  function awaitingOrder() {
    const o = createOrderRow("p1");
    getDb().prepare("UPDATE orders SET paypal_order_id = 'PO1', status = 'awaiting_approval' WHERE id = ?").run(o.id);
    return o.id;
  }
  const captured: Order = {
    id: "PO1",
    status: "COMPLETED",
    purchaseUnits: [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { currencyCode: "USD", value: "274.99" } }] } }],
  };

  it("asks for the full representation and records the capture", async () => {
    const stub = client([() => json(201, orderWire(captured))]);
    const id = awaitingOrder();

    const out = await captureCheckoutOrder(id);

    expect(out).toMatchObject({ captureId: "CAP1", capturedCents: 27499, status: "COMPLETED" });
    expect(stub.ops()[0]!.request.headers.get("prefer")).toBe("return=representation");
    expect(stub.ops()[0]!.claimsAtSend).toContain("capture:PO1");
    // PayPal answers 415 when the capture carries no Content-Type, so an empty JSON body is sent.
    expect(stub.ops()[0]!.request.headers.get("content-type")).toContain("application/json");
    expect(stub.ops()[0]!.body).toBe("{}");
  });

  it("settles a timeout by re-reading the order with getOrder", async () => {
    const stub = client([
      () => { throw new Error("socket hang up"); },
      (url, req) => {
        expect(req.method).toBe("GET");
        expect(url.pathname).toBe("/v2/checkout/orders/PO1");
        return json(200, orderWire(captured));
      },
    ]);
    const id = awaitingOrder();

    const out = await captureCheckoutOrder(id);

    expect(out.captureId).toBe("CAP1");
    expect(stub.ops().map((c) => c.request.method)).toEqual(["POST", "GET"]);
  });

  it("refuses to capture an order this app did not create", async () => {
    const stub = client([]);
    await expect(captureCheckoutOrder("not-ours")).rejects.toBeInstanceOf(InvariantError);
    expect(stub.calls).toHaveLength(0);
  });
});

// ---- refundCapturedPayment ----

describe("issuePriceMatchRefund", () => {
  const refunded: Refund = { id: "RF1", status: "COMPLETED" };

  it("sends amount, custom_id and note only, with the claim taken first", async () => {
    const stub = client([() => json(201, refundWire(refunded))]);
    const orderId = seedCapturedOrder();

    const out = await issuePriceMatchRefund({ claimId: "c1", orderId, amountCents: 4500, retailer: "bhphotovideo.com" });

    expect(out).toMatchObject({ refundId: "RF1", status: "COMPLETED", amountCents: 4500 });
    const [call] = stub.ops();
    expect(call!.url.pathname).toBe("/v2/payments/captures/CAP1/refund");
    expect(call!.claimsAtSend).toContain("refund:c1");
    expect(call!.request.headers.get("paypal-request-id")).toBe("refund:c1");
    const body = JSON.parse(call!.body!);
    expect(Object.keys(body).sort()).toEqual(["amount", "custom_id", "note_to_payer"]);
    expect(body.amount).toEqual({ currency_code: "USD", value: "45.00" });
    expect(body.custom_id).toBe("c1");
  });

  it("returns the recorded refund for a repeated claim without a second PayPal call", async () => {
    const stub = client([() => json(201, refundWire(refunded))]);
    const orderId = seedCapturedOrder();
    await issuePriceMatchRefund({ claimId: "c1", orderId, amountCents: 4500, retailer: "x" });

    const again = await issuePriceMatchRefund({ claimId: "c1", orderId, amountCents: 4500, retailer: "x" });

    expect(again.refundId).toBe("RF1");
    expect(stub.ops()).toHaveLength(1);
  });

  it("rejects a second price-match claim on the same order before anything is sent", async () => {
    const stub = client([() => json(201, refundWire(refunded))]);
    const orderId = seedCapturedOrder();
    await issuePriceMatchRefund({ claimId: "c1", orderId, amountCents: 4500, retailer: "x" });

    await expect(issuePriceMatchRefund({ claimId: "c2", orderId, amountCents: 1000, retailer: "y" })).rejects.toMatchObject({ status: 409 });
    expect(stub.ops()).toHaveLength(1);
  });

  it("enforces the merchant cap and the remaining amount before the claim or any call", async () => {
    const stub = client([]);
    const orderId = seedCapturedOrder();

    await expect(issuePriceMatchRefund({ claimId: "c1", orderId, amountCents: 20000, retailer: "x" })).rejects.toBeInstanceOf(InvariantError);
    await expect(issuePriceMatchRefund({ claimId: "c2", orderId, amountCents: 0, retailer: "x" })).rejects.toBeInstanceOf(InvariantError);
    expect(stub.calls).toHaveLength(0);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM paypal_writes").get()).toEqual({ n: 0 });
  });

  it("refuses to refund an order that was never captured, before anything is sent", async () => {
    const stub = client([]);
    const o = createOrderRow("p1");
    getDb().prepare("UPDATE orders SET paypal_order_id = 'PO2', status = 'awaiting_approval' WHERE id = ?").run(o.id);

    await expect(issuePriceMatchRefund({ claimId: "c1", orderId: o.id, amountCents: 1000, retailer: "x" })).rejects.toMatchObject({ status: 409 });
    expect(stub.calls).toHaveLength(0);
  });

  it("passes PayPal's reason through on a 422 and releases the claim", async () => {
    client([() => json(422, paypalError("UNPROCESSABLE_ENTITY", "The requested action could not be performed.", "REFUND_AMOUNT_EXCEEDED"))]);
    const orderId = seedCapturedOrder();

    const err = await issuePriceMatchRefund({ claimId: "c1", orderId, amountCents: 4500, retailer: "x" }).catch((e) => e);

    expect(err).toBeInstanceOf(PaypalRefusedError);
    const http = toHttp(err);
    expect(http.status).toBe(422);
    expect(http.message).toBe("PayPal won't refund more than what is left on this payment. (REFUND_AMOUNT_EXCEEDED)");
    expect((err as PaypalRefusedError).reason).toContain("REFUND_AMOUNT_EXCEEDED description"); // full reason kept for logs
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM refunds").get()).toEqual({ n: 0 });
  });

  it("maps PayPal refusing our credentials to 502 with a fixed message", async () => {
    client([() => json(401, paypalError("AUTHENTICATION_FAILURE", "Authentication failed"))]);
    const orderId = seedCapturedOrder();

    const err = await issuePriceMatchRefund({ claimId: "c1", orderId, amountCents: 4500, retailer: "x" }).catch((e) => e);

    expect(toHttp(err)).toEqual({ status: 502, message: "Payment provider rejected our credentials." });
  });

  it("settles a lost refund answer by finding our custom_id on the order", async () => {
    const stub = client([
      () => { throw new Error("ECONNRESET"); },
      () => json(200, orderWire({ id: "PO1", purchaseUnits: [{ payments: { refunds: [{ id: "RF9", status: "COMPLETED", customId: "c1" }] } }] })),
    ]);
    const orderId = seedCapturedOrder();

    const out = await issuePriceMatchRefund({ claimId: "c1", orderId, amountCents: 4500, retailer: "x" });

    expect(out.refundId).toBe("RF9");
    expect(stub.ops().map((c) => `${c.request.method} ${c.url.pathname}`)).toEqual([
      "POST /v2/payments/captures/CAP1/refund",
      "GET /v2/checkout/orders/PO1",
    ]);
  });
});
