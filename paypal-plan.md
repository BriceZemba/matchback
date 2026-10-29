# PayPal integration plan — Matchback

Contract sheet for the PayPal part of Matchback, written before any application code, from the SDK map and source shipped inside the installed package (`paypal` 2.29.0, built from github.com/context-plugins/paypal-typescript-sdk, `main`). Every fact below comes from `node_modules/paypal/sdk-map.md`, `map/operations/{orders,payments}.md`, `api-reference.md` and the model files named in each row, or from a sandbox smoke run recorded under **Verified against the sandbox**. Nothing here comes from memory.

## Scope

The vertical slice: a shopper pays for one catalog product with PayPal (sandbox), then files a price-match claim; when the verifier approves it, Matchback refunds the difference on the PayPal capture and reads the refund back through a different call than the one that wrote it.

| Operation | Why |
| --- | --- |
| `client.orders.createOrder` | create the checkout order for one product |
| `client.orders.captureOrder` | capture after the buyer approves |
| `client.orders.getOrder` | read-back after capture; settle unknown capture and refund outcomes |
| `client.payments.refundCapturedPayment` | the partial refund for an approved claim |
| `client.payments.getRefund` | independent read-back of the refund |
| `client.payments.getCapturedPayment` | independent read-back of the capture status (`PARTIALLY_REFUNDED`) |

Out of scope for the slice: subscriptions, vault, disputes, transaction search, webhooks (the SDK has no webhook surface; none are needed because every write is followed by an explicit read-back).

## Repo survey and toolchain

- Greenfield repo. `package.json` has `"type": "module"`, so the project is **ESM** and imports `paypal` through `dist/esm`. Only one dialect is loaded, so `instanceof` on SDK error classes is reliable; the code still narrows on `err.kind` first.
- Runtime: Node 22.16.0 (SDK floor `>=20.3`). Package manager: npm 11.4.2. Host app: Next.js (App Router) server routes, Node runtime only (never edge), so the client lives in a server-only module.
- `tsconfig` to be created with `strict: true`; `exactOptionalPropertyTypes` and `verbatimModuleSyntax` stay off (Next.js defaults), and model types are still imported with `import type`.
- Checks: `npx tsc --noEmit` (type check, the gate after every change) and `npx vitest run` (tests). Baseline on the untouched tree: no app source exists yet, so the baseline is empty; `node -e "require('paypal')"` and the ESM import both load (2026-10-29).
- Local store for claims and records: `node:sqlite` (`DatabaseSync`, built into Node 22). A duplicate primary or unique key raises `ERR_SQLITE_ERROR` with `errcode` 1555 (primary key) or 2067 (unique), observed 2026-10-29; the code recognises the duplicate by `errcode`, never by message.

## Host and credentials

- The SDK declares one environment and no `ServerEnvironment`; its default base URL is `https://api-m.sandbox.paypal.com` (`src/servers.ts`). Matchback is sandbox-only for the hackathon.
- The client is built with `serverOptions: { baseUrl: "https://api-m.sandbox.paypal.com" }` written out, and startup fails unless `PAYPAL_ENV` is exactly `sandbox` **and** the base URL is that sandbox host. There is no code path that reaches `api-m.paypal.com`.
- Auth: `oauth2: { clientId, clientSecret }` from `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`. Both are checked non-empty in the factory before construction (an unset field is not an SDK error; it only 401s later). Token endpoint `default` + `/v1/oauth2/token`, Basic auth, cached on the client.
- One client per server process, built lazily by a factory in a server-only module and reused; never one per request (the token cache and resource getters live on it). No `close()` exists or is needed.

## Verified against the sandbox (scratchpad smoke, 2026-10-29)

- `createOrder` with `intent: "CAPTURE"`, one purchase unit of USD 1.00 → `201`, `status: "CREATED"`, links `self, approve, update, capture`. `getOrder` on it → `status: "CREATED"`, amount `1.00`.
- `createOrder` with `paymentSource.paypal.experienceContext.{returnUrl, cancelUrl}` set to `http://localhost:3000/...` → `200`, `status: "PAYER_ACTION_REQUIRED"`, links `self, payer-action`. Localhost return URLs are accepted in sandbox.
- **The same `createOrder` request sent twice with the same `payPalRequestId` returned the same order id both times.** This is the settle path for an unknown `createOrder` outcome.
- The credential's token carries orders/payments, disputes and reporting scopes (`scripts/check-keys.mjs`).

## End-to-end sandbox run (2026-10-29)

Order `0FD991758W2058720`, Logitech MX Master 3S, USD 119.99, approved by the sandbox buyer in a browser.

1. First capture attempt, no request body → **415** "The request payload is not supported" (debug id `ca51e23c05e60`). Claim released, nothing captured. Fixed by sending `body: {}`; a test now pins the `Content-Type` and the `{}` body.
2. Capture retried through the return route → capture `48896410CU848762F`, `COMPLETED`, 119.99. `getOrder` read-back: order `COMPLETED`, capture `COMPLETED`.
3. Partial refund of USD 20.00 (the gap to a USD 99.99 new, in-stock Office Depot offer seen in the Channel3 spike) → refund `503133989R6541103`, `COMPLETED`.
4. Read-back through other calls: `getRefund` → `COMPLETED`, 20.00 USD, `customId` equals the claim id; `getCapturedPayment` → `PARTIALLY_REFUNDED`.
5. `getOrder` lists the refund under `purchase_units[0].payments.refunds` **with `customId` populated** — the UNKNOWN OUTCOMES settle path for refunds is verified.
6. A second price-match refund on the same order → **409** from Matchback, no PayPal request, no claim left behind.

## Contract sheet

Shared facts (from `sdk-map.md`): call shape `op(request, options?)`, one flat channel-blind request object; returns `ApiPromise<T, E>`; `.asApiResult()` must be called on the returned value, before any `.then()`. Every non-GET call carries an SDK-minted `Idempotency-Key` per call, which does **not** span calls. Retries default to GET/HEAD/PUT/OPTIONS on 408/429/500/502/503/504, connection loss and timeout, `maxRetries: 3`, `timeout: 60_000` ms per attempt. No pagination, no streaming, no hooks. None of the six operations here resolves to `undefined`.

Import aliases: `import type { Error as PaypalApiErrorBody } from "paypal"` wherever the SDK's `Error` model is named (it would shadow the global otherwise). The error family is `PaypalError`.

### `createOrder`

- Signature: `createOrder(request: Orders.CreateOrderRequest, options?: RequestOptions): ApiPromise<Order, Orders.CreateOrderError>`
- Wire: `POST /v2/checkout/orders` · Auth `oauth2` · Request body `application/json`, field `body`, **required** · SDK-sent `Idempotency-Key`
- Returns `Order` (`src/models/order.ts`): every member optional — `id?`, `status?` (`OrderStatus`), `links?` (`LinkDescription[]`: `href: string`, `rel: string`, `method?`), `purchaseUnits?`.
- Error arms (`Orders.CreateOrderError`): `"error"` [400] `Error` · `"error2"` [401] `Error` · `"error3"` [422] `Error` · `"error4"` [default] `Error` · `"undeclared"` [default body that did not fit] `rawBody`.

| Field | Channel | Wire | Type | Req | Default |
| --- | --- | --- | --- | --- | --- |
| `payPalMockResponse` | header | `PayPal-Mock-Response` | `string` | no | — |
| `payPalRequestId` | header | `PayPal-Request-Id` | `string` | no | — |
| `payPalPartnerAttributionId` | header | `PayPal-Partner-Attribution-Id` | `string` | no | — |
| `payPalClientMetadataId` | header | `PayPal-Client-Metadata-Id` | `string` | no | — |
| `prefer` | header | `Prefer` | `string` | no | `"return=minimal"` (sent even when omitted) |
| `payPalAuthAssertion` | header | `PayPal-Auth-Assertion` | `string` | no | — |
| `body` | body | — | `OrderRequest` | yes | — |

`OrderRequest` (`src/models/order-request.ts`): `intent: CheckoutPaymentIntent` (required; open enum, member `Capture: "CAPTURE"` in `src/models/checkout-payment-intent.ts`) · `purchaseUnits: PurchaseUnitRequest[]` (required) · `paymentSource?: PaymentSource` · others optional and unused.
`PurchaseUnitRequest` (`src/models/purchase-unit-request.ts`): `amount: AmountWithBreakdown` (required) · `customId?`, `description?`, `invoiceId?`, `referenceId?`, `items?`, ... optional.
`AmountWithBreakdown` (`src/models/amount-with-breakdown.ts`): `currencyCode: string`, `value: string` (both required) · `breakdown?`.
`PaymentSource.paypal?: PayPalWallet` (`src/models/payment-source.ts` → `src/models/pay-pal-wallet.ts`) · `PayPalWallet.experienceContext?: PayPalWalletExperienceContext` (`src/models/pay-pal-wallet-experience-context.ts`): `returnUrl?`, `cancelUrl?`, `brandName?`, ... **Note:** that schema fills defaults on encode for `shippingPreference`, `contactPreference`, `landingPage` (`NoPreference`), `userAction` (`Continue`) and `paymentMethodPreference` whenever `experienceContext` is present, so those are sent too.

Approval link: with `paymentSource.paypal` set, the order comes back `PAYER_ACTION_REQUIRED` with a `payer-action` link (observed); without it, `CREATED` with an `approve` link. The app sends the buyer to the `payer-action` link and requires it to be present (asserted, since `links` is optional).

### `captureOrder`

- Signature: `captureOrder(request: Orders.CaptureOrderRequest, options?: RequestOptions): ApiPromise<Order, Orders.CaptureOrderError>`
- Wire: `POST /v2/checkout/orders/{id}/capture` · Auth `oauth2` · Request body `application/json`, field `body`, **optional** (omitted: no body, no `Content-Type`) · SDK-sent `Idempotency-Key`
- Returns `Order`. The capture is at `purchaseUnits[0].payments.captures[0]` (`PurchaseUnit.payments?: PaymentCollection` → `captures?: OrdersCapture[]`, `src/models/orders-capture.ts`: `id?`, `status?` (`CaptureStatus`), `amount?: Money`). With the default `Prefer: return=minimal` the body carries only id, status and links (`api-reference.md`), so `prefer: "return=representation"` is required to read the capture id and amount.
- Error arms (`Orders.CaptureOrderError`): `"error"` [400] · `"error2"` [401] · `"error3"` [403] · `"error4"` [404] · `"error5"` [422] · `"error6"` [500] · `"error7"` [default] — all `Error` · `"undeclared"` `rawBody`.

| Field | Channel | Wire | Type | Req | Default |
| --- | --- | --- | --- | --- | --- |
| `id` | path | — | `string` | yes | — |
| `payPalMockResponse` | header | `PayPal-Mock-Response` | `string` | no | — |
| `payPalRequestId` | header | `PayPal-Request-Id` | `string` | no | — |
| `prefer` | header | `Prefer` | `string` | no | `"return=minimal"` |
| `payPalClientMetadataId` | header | `PayPal-Client-Metadata-Id` | `string` | no | — |
| `payPalAuthAssertion` | header | `PayPal-Auth-Assertion` | `string` | no | — |
| `body` | body | — | `OrderCaptureRequest` | no | — |

Members asserted after capture (all optional in the model): `order.status === "COMPLETED"`, capture `id`, capture `status`, capture `amount.value` and `amount.currencyCode`. Any missing → outcome unknown, settled by `getOrder`.

### `getOrder`

- Signature: `getOrder(request: Orders.GetOrderRequest, options?: RequestOptions): ApiPromise<Order, Orders.GetOrderError>`
- Wire: `GET /v2/checkout/orders/{id}` · Auth `oauth2` · no body · retried by default.
- Error arms (`Orders.GetOrderError`): `"error"` [401] · `"error2"` [404] · `"error3"` [default] — all `Error` · `"undeclared"` `rawBody`.
- Fields: `id` (path, required) · `fields` (query, optional) · `payPalMockResponse`, `payPalAuthAssertion` (headers, optional). Only `id` is set.
- Refunds on an order: `purchaseUnits[].payments.refunds?: Refund[]` (`src/models/payment-collection.ts`), each with `id?`, `status?`, `amount?`, `customId?`.

### `refundCapturedPayment`

- Signature: `refundCapturedPayment(request: Payments.RefundCapturedPaymentRequest, options?: RequestOptions): ApiPromise<Refund, Payments.RefundCapturedPaymentError>`
- Wire: `POST /v2/payments/captures/{capture_id}/refund` · Auth `oauth2` · Request body `application/json`, field `body`, **optional** (omitted = full refund; Matchback always sends it) · SDK-sent `Idempotency-Key`
- Returns `Refund` (`src/models/refund.ts`): `id?`, `status?` (`RefundStatus`: `CANCELLED`, `FAILED`, `PENDING`, `COMPLETED`), `amount?: Money`, `customId?`, `noteToPayer?`, `links?`.
- Error arms (`Payments.RefundCapturedPaymentError`): `"error"` [400] · `"error2"` [401] · `"error3"` [403] · `"error4"` [404] · `"error5"` [409] · `"error6"` [422] — all `Error` · `"error500"` [500] **no body** (a JSON body on a 500 becomes a `DecodeError`) · `"error7"` [default] `Error` · `"undeclared"` `rawBody`.

| Field | Channel | Wire | Type | Req | Default |
| --- | --- | --- | --- | --- | --- |
| `captureId` | path | `capture_id` | `string` | yes | — |
| `payPalMockResponse` | header | `PayPal-Mock-Response` | `string` | no | — |
| `payPalRequestId` | header | `PayPal-Request-Id` | `string` | no | — |
| `prefer` | header | `Prefer` | `string` | no | `"return=minimal"` |
| `payPalAuthAssertion` | header | `PayPal-Auth-Assertion` | `string` | no | — |
| `body` | body | — | `RefundRequest` | no | — |

`RefundRequest` (`src/models/refund-request.ts`): `amount?: Money` · `customId?` · `invoiceId?` · `noteToPayer?` · `paymentInstruction?` (marketplaces only). `Money` (`src/models/money.ts`): `currencyCode: string`, `value: string`, both required.
Members asserted after the refund: `refund.id` present (minimal response includes id and status). Missing → outcome unknown.

### `getRefund`

- Signature: `getRefund(request: Payments.GetRefundRequest, options?: RequestOptions): ApiPromise<Refund, Payments.GetRefundError>`
- Wire: `GET /v2/payments/refunds/{refund_id}` · no body · retried by default.
- Error arms (`Payments.GetRefundError`): `"error"` [401] · `"error2"` [403] · `"error3"` [404] — `Error` · `"error500"` [500] no body · `"error4"` [default] `Error` · `"undeclared"` `rawBody`.
- Fields: `refundId` (path, wire `refund_id`, required) · `payPalMockResponse`, `payPalAuthAssertion` (optional, unset).
- Asserted: `id`, `status`, `amount.value`, `amount.currencyCode`, `customId` equal to what Matchback sent.

### `getCapturedPayment`

- Signature: `getCapturedPayment(request: Payments.GetCapturedPaymentRequest, options?: RequestOptions): ApiPromise<CapturedPayment, Payments.GetCapturedPaymentError>`
- Wire: `GET /v2/payments/captures/{capture_id}` · no body · retried by default.
- Error arms (`Payments.GetCapturedPaymentError`): `"error"` [401] · `"error2"` [403] · `"error3"` [404] — `Error` · `"error500"` [500] no body · `"error4"` [default] `Error` · `"undeclared"` `rawBody`.
- Fields: `captureId` (path, wire `capture_id`, required) · `payPalMockResponse` (unset).
- `CapturedPayment` (`src/models/captured-payment.ts`): `status?` (`CaptureStatus`: `COMPLETED`, `DECLINED`, `PARTIALLY_REFUNDED`, ...), `amount?`, `id?`. Asserted after a partial refund: `status === "PARTIALLY_REFUNDED"`.

## 1b.1 Durable writes

All claims live in one table this app owns, `paypal_writes(claim_key TEXT PRIMARY KEY, op TEXT, request_id TEXT, state TEXT, result_json TEXT, created_at TEXT)`, inserted **before** the SDK call. `state` moves `claimed → done | refused | unknown`.

### DUPLICATE CLAIMS

| Write | Where the claim is stored | What rejects the second one | Where that rejection is caught | Where in the code |
| --- | --- | --- | --- | --- |
| `createOrder` | `paypal_writes`, `claim_key = "create:" + checkoutRef`, where `checkoutRef` is the Matchback order row id created when the buyer clicks Pay (one per cart, reused on re-click) | primary key on `claim_key` | `catch` on the insert, `errcode` 1555/2067 → load the existing row; if `done`, return its order and payer-action link; if `claimed`/`unknown`, settle (see UNKNOWN OUTCOMES) | `takeClaim` (`lib/paypal/claims.ts`) then `client.orders.createOrder` in `createCheckoutOrder` (`lib/paypal/checkout.ts`) |
| `captureOrder` | `paypal_writes`, `claim_key = "capture:" + paypalOrderId` | primary key on `claim_key` | same `errcode` catch → return the recorded capture, or settle via `getOrder` | `takeClaim` then `client.orders.captureOrder` in `captureCheckoutOrder` (`lib/paypal/checkout.ts`) |
| `refundCapturedPayment` | `paypal_writes`, `claim_key = "refund:" + claimId` (the price-match claim) **and** `refunds.capture_id` unique for price-match refunds (one price-match refund per order) | primary key on `claim_key`; unique on `refunds.capture_id` | same `errcode` catch → return the recorded refund, or settle via `getOrder` | `takeClaim` + `INSERT INTO refunds` then `client.payments.refundCapturedPayment` in `issuePriceMatchRefund` (`lib/paypal/refunds.ts`) |

Each write sends `payPalRequestId` = the `claim_key` (PayPal stores it for 6 hours, `api-reference.md`), so a re-send after a lost answer is joined by PayPal too. The claim is released (row deleted) when PayPal refuses the call with a 4xx, so a corrected attempt is not blocked.

### UNKNOWN OUTCOMES

| Write | The operation you re-read with | The reference you search by | Where in the code | The test that fails the connection |
| --- | --- | --- | --- | --- |
| `createOrder` | `createOrder` re-sent with the **same** `payPalRequestId` (verified 2026-10-29 to return the same order rather than create a second one; no order search exists in this SDK) | `payPalRequestId` = `"create:" + checkoutRef` | `settle` inside `createCheckoutOrder` (`lib/paypal/checkout.ts`) | `test/paypal.test.ts` › "settles a lost answer by re-sending with the same PayPal-Request-Id"; never-sent counterpart: "makes no re-read when the credential could not be obtained" |
| `captureOrder` | `getOrder({ id })` | `paypalOrderId`; settled when `status === "COMPLETED"` and a capture is present | `settle` inside `captureCheckoutOrder` (`lib/paypal/checkout.ts`) | `test/paypal.test.ts` › "settles a timeout by re-reading the order with getOrder" |
| `refundCapturedPayment` | `getOrder({ id: paypalOrderId })`, then `purchaseUnits[].payments.refunds[]` | `customId` = `claimId`, sent on the refund. Verified 2026-10-29: `getOrder` returns refunds with `customId` populated (refund `503133989R6541103`) | `settle` inside `issuePriceMatchRefund` (`lib/paypal/refunds.ts`) | `test/paypal.test.ts` › "settles a lost refund answer by finding our custom_id on the order" |

Never-sent failures (`AuthError`, `EncodeError`) release the claim and report a configuration or code error; they trigger no re-read (a second test asserts no re-read request).

## 1b.2 Cross-operation invariants

| Invariant | Where the legal set comes from | Enforced where | The test that proves it |
| --- | --- | --- | --- |
| A capture is attempted only for a PayPal order id this app created | `orders` table rows with that `paypal_order_id` and state `awaiting_approval` | before the `capture:` claim insert, `captureCheckoutOrder` | "refuses to capture an order this app did not create" |
| A refund targets only a capture this app recorded from its own `captureOrder` | `orders.capture_id` for a row in state `captured` | before the `refund:` claim insert, `issuePriceMatchRefund` | "refuses to refund an order that was never captured, before anything is sent" |
| Refund amount is > 0, in the capture's currency, ≤ captured amount minus refunds already recorded, and ≤ the merchant's per-order cap | the `orders` row (captured amount) + `refunds` rows + merchant settings | before the `refund:` claim insert, `issuePriceMatchRefund` | "enforces the merchant cap and the remaining amount before the claim or any call"; one-per-order: "rejects a second price-match claim on the same order before anything is sent" |
| The product named in a claim is the product on that order, from the pinned catalog | `catalog` table (fixed Channel3 product ids) and `orders.product_id` | when the claim is filed, before any verifier or refund call | not built yet (claim filing is the next step) |
| The checkout amount comes from the catalog price, never from the browser | `catalog` table | `createOrderRow` (`lib/paypal/checkout.ts`), before the `create:` claim | "takes the claim before the request leaves and sends only the fields the plan requires" (asserts the catalog amount 274.99 is sent) |

## 1b.3 Optional request fields

**createOrder**

| Field | What requires it | Set it? |
| --- | --- | --- |
| `payPalRequestId` | DUPLICATE CLAIMS / UNKNOWN OUTCOMES rows for `createOrder` | ✅ `"create:" + checkoutRef` |
| `prefer` | nothing (minimal response already carries id, status, links) | ❌ leave out (the SDK still sends its default `return=minimal`) |
| `payPalMockResponse`, `payPalPartnerAttributionId`, `payPalClientMetadataId`, `payPalAuthAssertion` | nothing | ❌ |
| `body.purchaseUnits[0].customId` | reconciliation from PayPal back to the Matchback order row | ✅ `checkoutRef` |
| `body.purchaseUnits[0].description` | the product: the buyer sees what they pay for | ✅ catalog title (truncated to fit) |
| `body.purchaseUnits[0].invoiceId`, `referenceId`, `items`, `payee`, `shipping`, `softDescriptor`, `breakdown` | nothing | ❌ |
| `body.paymentSource.paypal.experienceContext.returnUrl` / `cancelUrl` | the buyer must come back to Matchback after approving | ✅ app routes; the schema's encode defaults for the other experience fields are accepted |
| `brandName`, `locale`, `userAction`, `landingPage`, ... | nothing | ❌ |

**captureOrder**

| Field | What requires it | Set it? |
| --- | --- | --- |
| `payPalRequestId` | DUPLICATE CLAIMS / UNKNOWN OUTCOMES rows for `captureOrder` | ✅ `"capture:" + paypalOrderId` |
| `prefer` | reading the capture id and amount, which the minimal response omits | ✅ `"return=representation"` |
| `body` | the sandbox: a capture sent without a body carries no `Content-Type`, and PayPal answers **415** "The request payload is not supported" (observed 2026-10-29, debug id ca51e23c05e60) | ✅ `{}` (an `OrderCaptureRequest` with no members) |
| `payPalMockResponse`, `payPalClientMetadataId`, `payPalAuthAssertion` | nothing | ❌ |

**refundCapturedPayment**

| Field | What requires it | Set it? |
| --- | --- | --- |
| `payPalRequestId` | DUPLICATE CLAIMS / UNKNOWN OUTCOMES rows for the refund | ✅ `"refund:" + claimId` |
| `body.amount` | the task: refund the price difference, not the whole payment | ✅ verified difference |
| `body.customId` | UNKNOWN OUTCOMES row for the refund (the reference searched by) | ✅ `claimId` |
| `body.noteToPayer` | the task: the shopper must see why they got money back | ✅ e.g. "Price match: lower price verified at <retailer>" |
| `prefer`, `body.invoiceId`, `body.paymentInstruction`, `payPalMockResponse`, `payPalAuthAssertion` | nothing | ❌ |

Reads (`getOrder`, `getRefund`, `getCapturedPayment`): only the path id is set.

Test: the request the SDK sent carries no header, query or body key set by Matchback beyond these rows (SDK-added headers excepted).

## 1b.4 When the API says no

Applies to `createOrder`, `captureOrder` and `refundCapturedPayment` (they carry data that comes from the shopper's cart, approval and claim). Reads use the read row.

| status | Matchback answers | the caller reads | test |
| --- | --- | --- | --- |
| a 4xx other than 401 / 403 / 429 (e.g. 422 `ORDER_NOT_APPROVED`, refund amount too high) | the same 4xx | a plain sentence for PayPal's issue code plus the code in brackets (`friendlyRefusal`, `lib/paypal/errors.ts`); PayPal's full reason (`message`, `details[].issue` / `description`, `debug_id`) is logged | fake a 422 with a reason; assert the issue code and the friendly sentence are in the response |
| 401 / 403 | 502 | "Payment provider rejected our credentials." | fake a 401; assert 502 and that message |
| 429 | 503 | "Payment provider is busy, try again shortly." | — |
| 5xx | 502 | "Payment provider error." | — |
| no response, on a write | per UNKNOWN OUTCOMES | "Outcome unknown, we are checking with PayPal." — never "failed" | — |
| no response, on a read | 502 | "Payment provider unreachable." | — |
| `DecodeError` on a 2xx | treated as no response on that write (unknown) | as above | — |
| `DecodeError` on an error status | that status's row | fixed message for the status | — |

The SDK `message` (method and URL) is logged, never returned.

### Implementation notes (2026-10-29)

- A **5xx** answer on a write is treated like no answer: it goes through the same settle path (re-send or `getOrder`) rather than being reported as failed, because PayPal may have acted. Routes then answer per 1b.4.
- Tests: `npx vitest run` → 15 passed; `npx tsc --noEmit` clean (2026-10-29).

## Retry, logging, pagination

- Retry: SDK defaults, with `retry.timeout: 15_000` ms per attempt. Writes (POST) are not added to `httpMethodsToRetry`: a lost write goes through UNKNOWN OUTCOMES instead.
- Logging: `logging: { level: "off" }` set explicitly, so `PAYPAL_CLIENT_LOG` cannot turn it on from outside. Request bodies never logged. Matchback logs its own line per write with the claim key, PayPal `debug_id` from the error body when present, and the outcome.
- No pagination or streaming is needed; none is built on the `fetch` seam. No custom `fetch` in production; tests pass a fake through `ClientOptions.fetch`.

## Assumptions & blockers

- Minor: buyer approval needs a sandbox personal account logged in on PayPal's sandbox site; demo orders are approved by hand in the browser. No blocker.
- `PENDING` refunds are still handled as a non-final state shown to the merchant.
- Resolved 2026-10-29: `getOrder` returns refunds with `customId`. Sandbox refunds completed immediately (`COMPLETED`).

## REQUIRED READING

- MUST load `typescript-error-handling` — every route wraps SDK calls; arms are per operation (loaded 2026-10-29).
- MUST load `typescript-client-initialization` — one long-lived client from a factory with the credential check (loaded 2026-10-29).
- MUST load `typescript-calling-endpoints` — flat request object, `.asApiResult()` on the returned value, defaulted `Prefer` still sent.
- MUST load `typescript-models` — open enums (`CheckoutPaymentIntent`, `OrderStatus`, `CaptureStatus`, `RefundStatus`), optional members asserted after each call.
- MUST load `typescript-configuration-resilience` — retry timeout, explicit `logging.level: "off"`.
- MUST load `typescript-authentication` — OAuth2 client credentials, `AuthError` with the token endpoint's error on `cause`.
- MUST load `typescript-testing` — fake `fetch` through `ClientOptions.fetch` for the unknown-outcome and invariant tests.
