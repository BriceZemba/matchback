import { PaypalClient, type ClientOptions } from "paypal";

// Matchback runs against the PayPal sandbox only. The SDK declares a single environment, so the host
// is pinned here explicitly and startup fails on anything else.
export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

let client: PaypalClient | undefined;

export function getPaypalClient(): PaypalClient {
  client ??= buildPaypalClient();
  return client;
}

export function buildPaypalClient(overrides: Pick<ClientOptions, "fetch" | "retry"> = {}): PaypalClient {
  const env = process.env.PAYPAL_ENV ?? "sandbox";
  if (env !== "sandbox") throw new Error(`PAYPAL_ENV must be "sandbox" (got "${env}")`);

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  // An unset credential is not an SDK error: it would only surface as a 401 later.
  if (!clientId) throw new Error("PAYPAL_CLIENT_ID is not configured");
  if (!clientSecret) throw new Error("PAYPAL_CLIENT_SECRET is not configured");

  return new PaypalClient({
    serverOptions: { baseUrl: PAYPAL_SANDBOX_BASE_URL },
    retry: { timeout: 15_000, ...overrides.retry },
    // Set explicitly so PAYPAL_CLIENT_LOG cannot switch logging on from outside the code.
    logging: { level: "off" },
    oauth2: { clientId, clientSecret },
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
  });
}

/** For tests: replace the shared client. */
export function setPaypalClientForTests(c: PaypalClient | undefined) {
  client = c;
}
