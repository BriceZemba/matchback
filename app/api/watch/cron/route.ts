import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { purgeOldScreenshots, reconcileStaleClaims } from "@/lib/verifier/run";
import { watchAll } from "@/lib/watch";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Daily job (vercel.json crons; Vercel sends "Authorization: Bearer $CRON_SECRET"): finish claims a crashed
// run left behind, then the price-watch pass.
export async function GET(req: Request) {
  if (!authorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const retried = await reconcileStaleClaims();
  const purged = await purgeOldScreenshots();
  const results = await watchAll();
  return NextResponse.json({ retried: retried.length, purged, checked: results.length, found: results.filter((r) => r.outcome === "found").length });
}
