import { NextResponse } from "next/server";
import { toHttp } from "@/lib/paypal/errors";
import { lastWatched, watchOrder } from "@/lib/watch";

export const runtime = "nodejs";

// "Check prices now" on the order page. The scheduled watch does the same thing in the background.
export async function POST(req: Request) {
  const form = await req.formData();
  const orderId = String(form.get("orderId") ?? "");
  const origin = new URL(req.url).origin;
  const back = `${origin}/orders/${encodeURIComponent(orderId)}`;
  const last = lastWatched(orderId);
  if (last && Date.now() - Date.parse(last) < 20_000) return NextResponse.redirect(back, 303);
  try {
    await watchOrder(orderId);
    return NextResponse.redirect(back, 303);
  } catch (err) {
    return NextResponse.redirect(`${back}?notice=${encodeURIComponent(toHttp(err).message)}`, 303);
  }
}
