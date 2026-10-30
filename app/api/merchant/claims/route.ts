import { claimRecords } from "@/lib/merchant";
import { feed, preflight } from "@/lib/merchant-http";
import type { ClaimStatus } from "@/lib/verifier/run";

export const runtime = "nodejs";

const STATUSES = ["verifying", "approved", "refused", "needs_review", "refunded", "refund_unknown", "refund_failed"];

/** Every claim as a flat row, newest first. ?status=needs_review for the review queue; ?limit= up to 1000. */
export function GET(req: Request) {
  return feed(req, (url) => {
    const status = url.searchParams.get("status");
    const limit = Number(url.searchParams.get("limit") ?? "500");
    return claimRecords({
      ...(status && STATUSES.includes(status) ? { status: status as ClaimStatus } : {}),
      ...(Number.isFinite(limit) ? { limit } : {}),
    });
  });
}

export const OPTIONS = preflight;
