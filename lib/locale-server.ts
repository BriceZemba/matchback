import { cookies, headers } from "next/headers";
import { dict, pickLocale, type Dict, type Locale } from "@/lib/i18n";

/** The shopper's language and theme for a server render (cookie, then browser language). */
export async function requestPrefs(): Promise<{ locale: Locale; t: Dict; theme: "light" | "dark" | null }> {
  const c = await cookies();
  const h = await headers();
  const locale = pickLocale(c.get("lang")?.value, h.get("accept-language"));
  const raw = c.get("theme")?.value;
  return { locale, t: dict(locale), theme: raw === "light" || raw === "dark" ? raw : null };
}
