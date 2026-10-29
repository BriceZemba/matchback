import { NextResponse } from "next/server";
import { captureCheckoutOrder } from "@/lib/paypal/checkout";
import { toHttp } from "@/lib/paypal/errors";

export const runtime = "nodejs";

// PayPal sends the buyer back here after approval; capture, then show the order.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderId = url.searchParams.get("order") ?? "";
  try {
    await captureCheckoutOrder(orderId);
  } catch (err) {
    console.error("capture failed", err);
    const { message } = toHttp(err);
    return NextResponse.redirect(`${url.origin}/orders/${encodeURIComponent(orderId)}?notice=${encodeURIComponent(message)}`, 303);
  }
  return NextResponse.redirect(`${url.origin}/orders/${encodeURIComponent(orderId)}`, 303);
}
