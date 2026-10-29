import { PaypalError, type Error as PaypalApiErrorBody } from "paypal";

// Matchback's own failure types for PayPal calls (paypal-plan.md 1b.4). Routes turn these into HTTP
// responses; the SDK's own message (method + URL) is logged, never returned.

/** PayPal refused the request; `status` and `reason` are safe to show the caller for a 4xx. */
export class PaypalRefusedError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | undefined,
    readonly debugId: string | undefined,
    readonly issue?: string,
    options?: ErrorOptions,
  ) {
    super(reason ?? `PayPal refused the request (${status})`, options);
  }
}

/** A write may or may not have taken effect, and re-reading could not settle it. Never "failed". */
export class OutcomeUnknownError extends Error {
  constructor(readonly claimKey: string, options?: ErrorOptions) {
    super(`Outcome unknown for ${claimKey}; checking with PayPal`, options);
  }
}

/** Configuration or code defect: nothing was sent (AuthError, EncodeError). */
export class PaypalIntegrationError extends Error {}

/** PayPal unreachable or answered with something unreadable on a read. */
export class PaypalUnavailableError extends Error {}

/** A request violated one of Matchback's own invariants before anything was sent. */
export class InvariantError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** PayPal's reason text from an SDK `Error` body: name, message and the first detail's issue. */
export function reasonFrom(body: PaypalApiErrorBody | undefined): string | undefined {
  if (!body) return undefined;
  const detail = body.details?.[0];
  const parts = [body.message, detail ? `${detail.issue}${detail.description ? `: ${detail.description}` : ""}` : undefined];
  return parts.filter(Boolean).join(" — ").slice(0, 300) || body.name;
}

/** PayPal's machine-readable issue code: the first detail's issue, else the error name. */
export function issueFrom(body: PaypalApiErrorBody | undefined): string | undefined {
  return body?.details?.[0]?.issue ?? body?.name;
}

// Shopper-facing sentences for the PayPal issues Matchback can meet. PayPal's full text stays in the
// logs; the issue code stays in brackets so support can trace it.
const FRIENDLY: Record<string, string> = {
  ORDER_NOT_APPROVED: "PayPal hasn't confirmed your payment yet. Finish approving it on PayPal, then press Check payment.",
  ORDER_ALREADY_CAPTURED: "This payment was already completed.",
  REFUND_AMOUNT_EXCEEDED: "PayPal won't refund more than what is left on this payment.",
  REFUND_EXCEEDED_TRANSACTION_AMOUNT: "PayPal won't refund more than what is left on this payment.",
  CAPTURE_FULLY_REFUNDED: "This payment has already been fully refunded.",
  REFUND_TIME_LIMIT_EXCEEDED: "PayPal's refund window for this payment has closed.",
  INSTRUMENT_DECLINED: "PayPal declined that payment method. Please choose another way to pay on PayPal.",
  PAYER_ACTION_REQUIRED: "PayPal needs one more step from you. Please finish on PayPal.",
};

export function friendlyRefusal(issue: string | undefined): string {
  const sentence = (issue && FRIENDLY[issue]) ?? "PayPal declined the request.";
  return issue ? `${sentence} (${issue})` : sentence;
}

/** Failures that mean nothing reached PayPal. */
export function wasNeverSent(err: unknown): boolean {
  return err instanceof PaypalError && (err.kind === "auth" || err.kind === "encode");
}

/** Failures after which a write's outcome is unknown: no response, or an unreadable 2xx body. */
export function isUnknownOutcome(err: unknown): boolean {
  if (!(err instanceof PaypalError)) return false;
  if (err.kind === "connection" || err.kind === "timeout") return true;
  return err.kind === "decode" && err.status >= 200 && err.status < 300;
}

/** HTTP mapping for a route boundary. */
export function toHttp(err: unknown): { status: number; message: string } {
  if (err instanceof InvariantError) return { status: err.status, message: err.message };
  if (err instanceof OutcomeUnknownError) return { status: 202, message: "Outcome unknown, we are checking with PayPal." };
  if (err instanceof PaypalRefusedError) {
    if (err.status === 401 || err.status === 403) return { status: 502, message: "Payment provider rejected our credentials." };
    if (err.status === 429) return { status: 503, message: "Payment provider is busy, try again shortly." };
    if (err.status >= 400 && err.status < 500) return { status: err.status, message: friendlyRefusal(err.issue) };
    return { status: 502, message: "Payment provider error." };
  }
  if (err instanceof PaypalUnavailableError) return { status: 502, message: "Payment provider unreachable." };
  if (err instanceof PaypalIntegrationError) return { status: 500, message: "Payment integration misconfigured." };
  return { status: 500, message: "Unexpected error." };
}
