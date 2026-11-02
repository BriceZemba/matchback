import { NextResponse } from "next/server";
import { readForm } from "@/lib/client";
import { isMerchantRequest } from "@/lib/merchant";
import { publicOrigin } from "@/lib/origin";
import { parseSettingsForm, resetStoreSettings, saveStoreSettings } from "@/lib/store-settings";

export const runtime = "nodejs";

// The settings form on /merchant/settings: save the rules, or go back to the defaults (?reset=1).
export async function POST(req: Request) {
  const origin = publicOrigin(req);
  if (!isMerchantRequest(req)) return NextResponse.json({ error: "Sign in as the merchant first." }, { status: 401 });
  if (new URL(req.url).searchParams.has("reset")) {
    await resetStoreSettings();
    return NextResponse.redirect(`${origin}/merchant/settings?done=reset`, 303);
  }
  const parsed = parseSettingsForm(await readForm(req));
  if ("error" in parsed) {
    const store = parsed.store ? `&store=${encodeURIComponent(parsed.store)}` : "";
    return NextResponse.redirect(`${origin}/merchant/settings?error=${parsed.error}${store}`, 303);
  }
  await saveStoreSettings(parsed.settings);
  return NextResponse.redirect(`${origin}/merchant/settings?done=saved`, 303);
}
