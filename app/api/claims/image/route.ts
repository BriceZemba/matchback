import { after, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { toHttp } from "@/lib/paypal/errors";
import { cookieValue, pickLocale } from "@/lib/i18n";
import { clientKey, readForm } from "@/lib/client";
import { fileImageClaim, verifyClaim } from "@/lib/verifier/run";

export const runtime = "nodejs";
export const maxDuration = 120;

// Shopper sends a screenshot or photo of the cheaper offer. Stored, then verified in the background.
export async function POST(req: Request) {
  const form = await readForm(req);
  const orderId = String(form.get("orderId") ?? "");
  const file = form.get("image");
  const origin = publicOrigin(req);
  try {
    if (!(file instanceof File)) throw Object.assign(new Error("Choose an image to upload."), { status: 400 });
    const locale = pickLocale(cookieValue(req, "lang"), req.headers.get("accept-language"));
    const claim = await fileImageClaim(orderId, { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type }, locale, { client: clientKey(req) });
    // Runs after the redirect is sent; on Vercel the function stays alive for it (up to maxDuration).
    after(() => verifyClaim(claim.id).then(() => undefined, (err) => console.error("verification failed", claim.id, err)));
    return NextResponse.redirect(`${origin}/claims/${claim.id}`, 303);
  } catch (err) {
    const message = err instanceof Error && "status" in err ? err.message : toHttp(err).message;
    return NextResponse.redirect(`${origin}/orders/${encodeURIComponent(orderId)}?notice=${encodeURIComponent(message)}`, 303);
  }
}
