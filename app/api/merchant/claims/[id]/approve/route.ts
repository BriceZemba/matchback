import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { isMerchantRequest } from "@/lib/merchant";
import { toHttp } from "@/lib/paypal/errors";
import { toCents } from "@/lib/money";
import { approveReviewedClaim } from "@/lib/verifier/run";

export const runtime = "nodejs";
export const maxDuration = 60;

// A reviewer approves a claim sent to a person. The refund goes through the same guarded PayPal path.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = publicOrigin(req);
  if (!isMerchantRequest(req)) return NextResponse.json({ error: "Sign in as the merchant first." }, { status: 401 });
  const form = await req.formData();
  try {
    let cents: number;
    try {
      cents = toCents(String(form.get("amount") ?? "").trim().replace(/^\$/, ""));
    } catch {
      return NextResponse.redirect(`${origin}/merchant?error=${encodeURIComponent("Enter the refund as an amount, for example 12.50.")}#claim-${id}`, 303);
    }
    const claim = await approveReviewedClaim(id, cents, String(form.get("note") ?? ""));
    return NextResponse.redirect(`${origin}/merchant?done=${encodeURIComponent(claim.id)}&status=${claim.status}`, 303);
  } catch (err) {
    console.error("review approve failed", id, err);
    return NextResponse.redirect(`${origin}/merchant?error=${encodeURIComponent(toHttp(err).message)}#claim-${id}`, 303);
  }
}
