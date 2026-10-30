import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { MERCHANT_COOKIE } from "@/lib/merchant";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const res = NextResponse.redirect(`${publicOrigin(req)}/merchant`, 303);
  res.cookies.delete(MERCHANT_COOKIE);
  return res;
}
