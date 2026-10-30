import { after, NextResponse } from "next/server";
import { getClaim, isStale, reconcileClaim } from "@/lib/verifier/run";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claim = await getClaim(id);
  if (!claim) return NextResponse.json({ error: "not found" }, { status: 404 });
  // A run that crashed or timed out left this claim unfinished: retry it after answering.
  if (isStale(claim)) after(() => reconcileClaim(id).then(() => undefined, (err) => console.error("claim retry failed", id, err)));
  return NextResponse.json({
    id: claim.id,
    orderId: claim.order_id,
    competitorUrl: claim.competitor_url,
    source: claim.source,
    competitorDomain: claim.competitor_domain,
    status: claim.status,
    refundId: claim.refund_id,
    error: claim.error,
    evidence: claim.decision_json ? JSON.parse(claim.decision_json) : null,
  });
}
