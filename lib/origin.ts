/** The address the shopper used, for redirects and PayPal return URLs. Behind a host's proxy the request
 * URL can be an internal one, so: APP_BASE_URL if set, then the forwarded host, then the request URL. */
export function publicOrigin(req: Request): string {
  const configured = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const host = req.headers.get("x-forwarded-host");
  if (host) return `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  return new URL(req.url).origin;
}
