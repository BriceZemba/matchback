import { NextResponse } from "next/server";
import { isMerchantRequest } from "@/lib/merchant";

// JSON feeds for the merchant console. Read with "Authorization: Bearer <MERCHANT_KEY>"; the header
// (not a cookie) carries the key, so any origin may read them.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store",
};

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function feed(req: Request, build: (url: URL) => Promise<unknown>) {
  if (!isMerchantRequest(req)) return NextResponse.json({ error: "Send the merchant key as a Bearer token." }, { status: 401, headers: CORS });
  return NextResponse.json(await build(new URL(req.url)), { headers: CORS });
}
