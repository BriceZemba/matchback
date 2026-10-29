import { NextResponse } from "next/server";
import { watchAll } from "@/lib/watch";

export const runtime = "nodejs";
export const maxDuration = 300;

// Scheduled price-watch pass (vercel.json crons). Vercel sends "Authorization: Bearer $CRON_SECRET".
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = await watchAll();
  return NextResponse.json({ checked: results.length, found: results.filter((r) => r.outcome === "found").length });
}
