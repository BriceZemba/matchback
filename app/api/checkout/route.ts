import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { createCheckoutOrder, createOrderRow } from "@/lib/paypal/checkout";
import { clientKey, overBudget, readForm } from "@/lib/client";
import { InvariantError, toHttp } from "@/lib/paypal/errors";
import { cookieValue } from "@/lib/i18n";
import { MY_ORDERS_COOKIE, rememberOrder } from "@/lib/my-orders";

export const runtime = "nodejs";
export const maxDuration = 60;

// Buyer clicked "Pay with PayPal": create the Matchback order row (price from the catalog), then the
// PayPal order, then send the buyer to PayPal to approve.
export async function POST(req: Request) {
  const form = await readForm(req);
  const productId = String(form.get("productId") ?? "");
  const appBaseUrl = publicOrigin(req);
  // Each checkout spends a PayPal call and a row: a visitor gets plenty, a script does not.
  if (overBudget(`checkout:${clientKey(req) ?? "anonymous"}`, 12, 60_000)) {
    return NextResponse.redirect(`${appBaseUrl}/?error=${encodeURIComponent("Too many checkouts in a short time. Try again in a minute.")}`, 303);
  }
  try {
    const order = await createOrderRow(productId);
    const { approveUrl } = await createCheckoutOrder(order.id, appBaseUrl);
    // Remembered before PayPal, so the order can be found again even if the buyer never comes back.
    return rememberOrder(NextResponse.redirect(approveUrl, 303), cookieValue(req, MY_ORDERS_COOKIE), order.id, appBaseUrl.startsWith("https://"));
  } catch (err) {
    if (!(err instanceof InvariantError)) console.error("checkout failed", err);
    const { message } = toHttp(err);
    return NextResponse.redirect(`${appBaseUrl}/?error=${encodeURIComponent(message)}`, 303);
  }
}
