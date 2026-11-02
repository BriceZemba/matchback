import { after, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { cookieValue, pickLocale } from "@/lib/i18n";
import { toHttp } from "@/lib/paypal/errors";
import { verifyClaim } from "@/lib/verifier/run";
import { fileFromFinding } from "@/lib/watch";
import { clientKey, readForm } from "@/lib/client";

export const runtime = "nodejs";
export const maxDuration = 120;

// The shopper accepts a price drop the watch found. It becomes a normal claim and is verified again.
export async function POST(req: Request) {
  const form = await readForm(req);
  const findingId = String(form.get("findingId") ?? "");
  const orderId = String(form.get("orderId") ?? "");
  const origin = publicOrigin(req);
  try {
    const claim = await fileFromFinding(findingId, pickLocale(cookieValue(req, "lang"), req.headers.get("accept-language")), { client: clientKey(req) });
    // Runs after the redirect is sent; on Vercel the function stays alive for it (up to maxDuration).
    after(() => verifyClaim(claim.id).then(() => undefined, (err) => console.error("verification failed", claim.id, err)));
    return NextResponse.redirect(`${origin}/claims/${claim.id}`, 303);
  } catch (err) {
    console.error("watch claim failed", findingId, err);
    return NextResponse.redirect(`${origin}/orders/${encodeURIComponent(orderId)}?notice=${encodeURIComponent(toHttp(err).message)}`, 303);
  }
}
