import { claimRecords, summarize } from "@/lib/merchant";
import { feed, preflight } from "@/lib/merchant-http";

export const runtime = "nodejs";

/** Totals for the console: claims by outcome, money refunded, sales kept, most-claimed stores and products. */
export function GET(req: Request) {
  return feed(req, async () => summarize(await claimRecords({ limit: 1000 })));
}

export const OPTIONS = preflight;
