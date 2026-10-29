import { getClaimImage } from "@/lib/verifier/run";

export const runtime = "nodejs";

// The uploaded screenshot, served only for its own claim.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const image = await getClaimImage(id);
  if (!image) return new Response("not found", { status: 404 });
  return new Response(image.bytes, { headers: { "Content-Type": image.mime, "Cache-Control": "private, max-age=3600" } });
}
