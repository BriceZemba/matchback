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

/** The request's form fields; a body that is not a form reads as an empty form, so the route's own checks answer. */
export async function readForm(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    return new FormData();
  }
}

// A small sliding-window budget on each server instance, for routes that spend someone else's API calls.
const windows = new Map<string, number[]>();

export function overBudget(key: string, max: number, windowMs: number, nowMs = Date.now()): boolean {
  const times = (windows.get(key) ?? []).filter((t) => nowMs - t < windowMs);
  times.push(nowMs);
  windows.set(key, times);
  return times.length > max;
}
