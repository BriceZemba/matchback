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
  try {
    const claim = await refuseReviewedClaim(id, String((await req.formData()).get("note") ?? ""));
    return NextResponse.redirect(`${origin}/merchant?done=${encodeURIComponent(claim.id)}&status=${claim.status}`, 303);
  } catch (err) {
    return NextResponse.redirect(`${origin}/merchant?error=${encodeURIComponent(toHttp(err).message)}#claim-${id}`, 303);
  }
}
