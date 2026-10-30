import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { createCheckoutOrder, createOrderRow } from "@/lib/paypal/checkout";
import { toHttp } from "@/lib/paypal/errors";
import { cookieValue } from "@/lib/i18n";
import { MY_ORDERS_COOKIE, rememberOrder } from "@/lib/my-orders";

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
    // Remembered before PayPal, so the order can be found again even if the buyer never comes back.
    return rememberOrder(NextResponse.redirect(approveUrl, 303), cookieValue(req, MY_ORDERS_COOKIE), order.id, appBaseUrl.startsWith("https://"));
  } catch (err) {
    console.error("checkout failed", err);
    const { message } = toHttp(err);
    return NextResponse.redirect(`${appBaseUrl}/?error=${encodeURIComponent(message)}`, 303);
  }
}
