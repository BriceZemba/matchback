import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { toHttp } from "@/lib/paypal/errors";
import { issuePriceMatchRefund, readBackRefund } from "@/lib/paypal/refunds";

export const runtime = "nodejs";

// Development-only route for the vertical slice: issue a price-match refund for an order without the
// verifier, then read it back independently. Disabled unless MATCHBACK_DEV_ROUTES=1.
export async function POST(req: Request) {
  if (process.env.MATCHBACK_DEV_ROUTES !== "1") return NextResponse.json({ error: "not found" }, { status: 404 });
  const { orderId, amountCents, retailer } = (await req.json()) as { orderId: string; amountCents: number; retailer?: string };
  const claimId = `dev-${randomUUID()}`;
  try {
    const refund = await issuePriceMatchRefund({ claimId, orderId, amountCents, retailer: retailer ?? "a competing retailer" });
    const readBack = await readBackRefund(claimId);
    return NextResponse.json({ refund, readBack });
  } catch (err) {
    console.error("dev refund failed", err);
    const { status, message } = toHttp(err);
    return NextResponse.json({ error: message }, { status });
  }
}
