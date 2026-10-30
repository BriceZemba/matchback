import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { captureCheckoutOrder } from "@/lib/paypal/checkout";
import { toHttp } from "@/lib/paypal/errors";
import { cookieValue } from "@/lib/i18n";
import { MY_ORDERS_COOKIE, rememberOrder } from "@/lib/my-orders";

export const runtime = "nodejs";
export const maxDuration = 60;

// PayPal sends the buyer back here after approval; capture, then show the order.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const orderId = url.searchParams.get("order") ?? "";
  try {
    await captureCheckoutOrder(orderId);
  } catch (err) {
    console.error("capture failed", err);
    const { message } = toHttp(err);
    return NextResponse.redirect(`${origin}/orders/${encodeURIComponent(orderId)}?notice=${encodeURIComponent(message)}`, 303);
  }
  return rememberOrder(NextResponse.redirect(`${origin}/orders/${encodeURIComponent(orderId)}`, 303), cookieValue(req, MY_ORDERS_COOKIE), orderId, origin.startsWith("https://"));
}
