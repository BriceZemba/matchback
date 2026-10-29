import { NextResponse } from "next/server";
import { toHttp } from "@/lib/paypal/errors";
import { cookieValue, pickLocale } from "@/lib/i18n";
import { fileImageClaim, verifyClaim } from "@/lib/verifier/run";

export const runtime = "nodejs";

// Shopper sends a screenshot or photo of the cheaper offer. Stored, then verified in the background.
export async function POST(req: Request) {
  const form = await req.formData();
  const orderId = String(form.get("orderId") ?? "");
  const file = form.get("image");
  const origin = new URL(req.url).origin;
  try {
    if (!(file instanceof File)) throw Object.assign(new Error("Choose an image to upload."), { status: 400 });
    const locale = pickLocale(cookieValue(req, "lang"), req.headers.get("accept-language"));
    const claim = fileImageClaim(orderId, { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type }, locale);
    void verifyClaim(claim.id).catch((err) => console.error("verification failed", claim.id, err));
    return NextResponse.redirect(`${origin}/claims/${claim.id}`, 303);
  } catch (err) {
    const message = err instanceof Error && "status" in err ? err.message : toHttp(err).message;
    return NextResponse.redirect(`${origin}/orders/${encodeURIComponent(orderId)}?notice=${encodeURIComponent(message)}`, 303);
  }
}
