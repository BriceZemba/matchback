import { NextResponse } from "next/server";
import { readForm } from "@/lib/client";
import { publicOrigin } from "@/lib/origin";
import { keyMatches, merchantKey, merchantSession, MERCHANT_COOKIE } from "@/lib/merchant";

export const runtime = "nodejs";

// Signs the merchant in on /merchant: the typed key is compared, then only a value derived from it is stored.
export async function POST(req: Request) {
  const origin = publicOrigin(req);
  const key = merchantKey();
  const typed = String((await readForm(req)).get("key") ?? "");
  if (!key || !keyMatches(typed)) {
    await new Promise((r) => setTimeout(r, 600)); // slows down guessing
    return NextResponse.redirect(`${origin}/merchant?error=key`, 303);
  }
  const res = NextResponse.redirect(`${origin}/merchant`, 303);
  res.cookies.set(MERCHANT_COOKIE, merchantSession(key), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
