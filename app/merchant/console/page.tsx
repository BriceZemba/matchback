import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { loadConsoleData } from "@/lib/console-data";
import { isMerchantSession, merchantKey, MERCHANT_COOKIE } from "@/lib/merchant";
import { CONSOLE_MODELS, consoleAiEnabled } from "@/lib/console-ai";
import { ConsoleLoader } from "./console-loader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Matchback · merchant console" };

// The merchant console: an AG Studio report over every claim, check, order and refund, behind the
// store-desk sign-in. Rows are read here, on the server, and handed to Studio in memory.
export default async function ConsolePage() {
  if (!merchantKey()) notFound();
  if (!isMerchantSession((await cookies()).get(MERCHANT_COOKIE)?.value)) redirect("/merchant");
  const data = await loadConsoleData();
  return <ConsoleLoader data={data} licenseKey={process.env.AG_STUDIO_LICENSE || undefined} aiModels={consoleAiEnabled() ? CONSOLE_MODELS : undefined} />;
}
