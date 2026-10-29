import { NextResponse } from "next/server";
import { cookieValue, pickLocale } from "@/lib/i18n";
import { toHttp } from "@/lib/paypal/errors";
import { verifyClaim } from "@/lib/verifier/run";
import { fileFromFinding } from "@/lib/watch";

export const runtime = "nodejs";

// The shopper accepts a price drop the watch found. It becomes a normal claim and is verified again.
export async function POST(req: Request) {
  const form = await req.formData();
  const findingId = String(form.get("findingId") ?? "");
  const orderId = String(form.get("orderId") ?? "");
  const origin = new URL(req.url).origin;
  try {
    const claim = fileFromFinding(findingId, pickLocale(cookieValue(req, "lang"), req.headers.get("accept-language")));
    void verifyClaim(claim.id).catch((err) => console.error("verification failed", claim.id, err));
    return NextResponse.redirect(`${origin}/claims/${claim.id}`, 303);
  } catch (err) {
    return NextResponse.redirect(`${origin}/orders/${encodeURIComponent(orderId)}?notice=${encodeURIComponent(toHttp(err).message)}`, 303);
  }
}
