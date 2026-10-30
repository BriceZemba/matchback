import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { isMerchantRequest } from "@/lib/merchant";
import { toHttp } from "@/lib/paypal/errors";
import { refuseReviewedClaim } from "@/lib/verifier/run";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = publicOrigin(req);
  if (!isMerchantRequest(req)) return NextResponse.json({ error: "Sign in as the merchant first." }, { status: 401 });
  // The console's review widget asks for JSON; the store desk's form gets a redirect back.
  const wantsJson = req.headers.get("accept")?.includes("application/json") ?? false;
  try {
    const claim = await refuseReviewedClaim(id, String((await req.formData()).get("note") ?? ""));
    if (wantsJson) return NextResponse.json({ id: claim.id, status: claim.status, ...(claim.error ? { error: claim.error } : {}) });
    return NextResponse.redirect(`${origin}/merchant?done=${encodeURIComponent(claim.id)}&status=${claim.status}`, 303);
  } catch (err) {
    if (wantsJson) return NextResponse.json({ error: toHttp(err).message }, { status: toHttp(err).status });
    return NextResponse.redirect(`${origin}/merchant?error=${encodeURIComponent(toHttp(err).message)}#claim-${id}`, 303);
  }
}
