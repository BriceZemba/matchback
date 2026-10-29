import { after, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { toHttp } from "@/lib/paypal/errors";
import { cookieValue, pickLocale } from "@/lib/i18n";
import { fileClaim, verifyClaim } from "@/lib/verifier/run";

export const runtime = "nodejs";
export const maxDuration = 120;

// Shopper submits "I found it cheaper here". The claim is stored, verification runs in the background
// (Channel3 lookups can take tens of seconds when uncached), and the shopper watches the claim page.
export async function POST(req: Request) {
  const form = await req.formData();
  const orderId = String(form.get("orderId") ?? "");
  const competitorUrl = String(form.get("competitorUrl") ?? "");
  const origin = publicOrigin(req);
  try {
    const claim = await fileClaim(orderId, competitorUrl, pickLocale(cookieValue(req, "lang"), req.headers.get("accept-language")));
    // Runs after the redirect is sent; on Vercel the function stays alive for it (up to maxDuration).
    after(() => verifyClaim(claim.id).then(() => undefined, (err) => console.error("verification failed", claim.id, err)));
    return NextResponse.redirect(`${origin}/claims/${claim.id}`, 303);
  } catch (err) {
    const { message } = toHttp(err);
    return NextResponse.redirect(`${origin}/orders/${encodeURIComponent(orderId)}?notice=${encodeURIComponent(message)}`, 303);
  }
}
