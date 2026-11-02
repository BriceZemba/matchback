import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { captureCheckoutOrder, checkCheckoutOrder } from "@/lib/paypal/checkout";
import { toHttp, unfinishedPayment } from "@/lib/paypal/errors";
import { cookieValue } from "@/lib/i18n";
import { MY_ORDERS_COOKIE, rememberOrder } from "@/lib/my-orders";

export const runtime = "nodejs";
export const maxDuration = 60;

// PayPal sends the buyer back here after approval; capture, then show the order. The order page's
// Check payment button lands here too (check=1), with no approval to assume.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const orderId = url.searchParams.get("order") ?? "";
  try {
    await (url.searchParams.has("check") ? checkCheckoutOrder(orderId) : captureCheckoutOrder(orderId));
  } catch (err) {
    const unfinished = unfinishedPayment(err);
    if (unfinished) return NextResponse.redirect(`${origin}/orders/${encodeURIComponent(orderId)}?payment=${unfinished}`, 303);
    console.error("capture failed", err);
    const { message } = toHttp(err);
    return NextResponse.redirect(`${origin}/orders/${encodeURIComponent(orderId)}?notice=${encodeURIComponent(message)}`, 303);
  }
  return rememberOrder(NextResponse.redirect(`${origin}/orders/${encodeURIComponent(orderId)}`, 303), cookieValue(req, MY_ORDERS_COOKIE), orderId, origin.startsWith("https://"));
}
