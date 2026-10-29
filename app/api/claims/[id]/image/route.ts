import { readFileSync } from "node:fs";
import { getClaim } from "@/lib/verifier/run";

export const runtime = "nodejs";

// The uploaded screenshot, served only for its own claim.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claim = getClaim(id);
  if (!claim || claim.source !== "image" || !claim.image_path || !claim.image_mime) return new Response("not found", { status: 404 });
  try {
    return new Response(readFileSync(claim.image_path), { headers: { "Content-Type": claim.image_mime, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
