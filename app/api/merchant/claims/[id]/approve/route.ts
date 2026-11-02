import { NextResponse } from "next/server";
import { readForm } from "@/lib/client";
import { publicOrigin } from "@/lib/origin";
import { isMerchantRequest } from "@/lib/merchant";
import { InvariantError, toHttp } from "@/lib/paypal/errors";
import { toCents } from "@/lib/money";
import { approveReviewedClaim } from "@/lib/verifier/run";

export const runtime = "nodejs";
export const maxDuration = 60;

// A reviewer approves a claim sent to a person. The refund goes through the same guarded PayPal path.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = publicOrigin(req);
  if (!isMerchantRequest(req)) return NextResponse.json({ error: "Sign in as the merchant first." }, { status: 401 });
  // The console's review widget asks for JSON; the store desk's form gets a redirect back.
  const wantsJson = req.headers.get("accept")?.includes("application/json") ?? false;
  const form = await readForm(req);
  try {
    let cents: number;
    try {
      cents = toCents(String(form.get("amount") ?? "").trim().replace(/^\$/, ""));
    } catch {
      const message = "Enter the refund as an amount, for example 12.50.";
      if (wantsJson) return NextResponse.json({ error: message }, { status: 400 });
      return NextResponse.redirect(`${origin}/merchant?error=${encodeURIComponent(message)}#claim-${id}`, 303);
    }
    const claim = await approveReviewedClaim(id, cents, String(form.get("note") ?? ""));
    if (wantsJson) return NextResponse.json({ id: claim.id, status: claim.status, ...(claim.error ? { error: claim.error } : {}) });
    return NextResponse.redirect(`${origin}/merchant?done=${encodeURIComponent(claim.id)}&status=${claim.status}`, 303);
  } catch (err) {
    if (!(err instanceof InvariantError)) console.error("review approve failed", id, err);
    if (wantsJson) return NextResponse.json({ error: toHttp(err).message }, { status: toHttp(err).status });
    return NextResponse.redirect(`${origin}/merchant?error=${encodeURIComponent(toHttp(err).message)}#claim-${id}`, 303);
  }
}
