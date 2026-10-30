import { createHash } from "node:crypto";

/**
 * Who sent a request, for per-visitor limits: a hash of the IP address the host reports (Vercel sets
 * x-forwarded-for). Only the hash is stored. Undefined when the host reports no address.
 */
export function clientKey(req: Request): string | undefined {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim();
  if (!ip) return undefined;
  return createHash("sha256").update(`matchback-client:${ip}`).digest("hex").slice(0, 32);
}
