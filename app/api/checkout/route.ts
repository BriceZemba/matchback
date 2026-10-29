import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { createCheckoutOrder, createOrderRow } from "@/lib/paypal/checkout";
import { toHttp } from "@/lib/paypal/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

// Buyer clicked "Pay with PayPal": create the Matchback order row (price from the catalog), then the
// PayPal order, then send the buyer to PayPal to approve.
export async function POST(req: Request) {
  const form = await req.formData();
  const productId = String(form.get("productId") ?? "");
  const appBaseUrl = publicOrigin(req);
  try {
    const order = await createOrderRow(productId);
    const { approveUrl } = await createCheckoutOrder(order.id, appBaseUrl);
    return NextResponse.redirect(approveUrl, 303);
  } catch (err) {
    console.error("checkout failed", err);
    const { message } = toHttp(err);
    return NextResponse.redirect(`${appBaseUrl}/?error=${encodeURIComponent(message)}`, 303);
  }
}
