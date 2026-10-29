import { NextResponse } from "next/server";
import { toHttp } from "@/lib/paypal/errors";
import { fileClaim, verifyClaim } from "@/lib/verifier/run";

export const runtime = "nodejs";

// Shopper submits "I found it cheaper here". The claim is stored, verification runs in the background
// (Channel3 lookups can take tens of seconds when uncached), and the shopper watches the claim page.
export async function POST(req: Request) {
  const form = await req.formData();
  const orderId = String(form.get("orderId") ?? "");
  const competitorUrl = String(form.get("competitorUrl") ?? "");
  const origin = new URL(req.url).origin;
  try {
    const claim = fileClaim(orderId, competitorUrl);
    void verifyClaim(claim.id).catch((err) => console.error("verification failed", claim.id, err));
    return NextResponse.redirect(`${origin}/claims/${claim.id}`, 303);
  } catch (err) {
    const { message } = toHttp(err);
    return NextResponse.redirect(`${origin}/orders/${encodeURIComponent(orderId)}?notice=${encodeURIComponent(message)}`, 303);
  }
}
