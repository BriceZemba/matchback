import { after, NextResponse } from "next/server";
import { clientKey, overBudget } from "@/lib/client";
import { handleMcp, rpcError } from "@/lib/mcp";
import { publicOrigin } from "@/lib/origin";
import { verifyClaim } from "@/lib/verifier/run";

export const runtime = "nodejs";
export const maxDuration = 120;

// MCP endpoint for shoppers' AI agents (Streamable HTTP, stateless, JSON responses). See lib/mcp.ts.
// Each request is answered on its own; there is no session and no server-to-client stream.

const MAX_REQUESTS_PER_CLIENT_PER_MINUTE = 60;

export async function POST(req: Request) {
  const client = clientKey(req);
  if (client && overBudget(`mcp:${client}`, MAX_REQUESTS_PER_CLIENT_PER_MINUTE, 60_000)) {
    return NextResponse.json(rpcError(null, -32000, "Too many requests from this address. Try again in a minute."), { status: 429 });
  }
  let message: unknown;
  try {
    message = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "The body is not JSON."), { status: 400 });
  }
  const reply = await handleMcp(message, {
    origin: publicOrigin(req),
    client,
    verify: (claimId) => verifyClaim(claimId),
    // A verification that outlasts the wait keeps running after the answer, as on the order page.
    background: (work) => after(() => work.then(() => undefined, (err) => console.error("verification failed", err))),
  });
  if (reply === null) return new Response(null, { status: 202 });
  return NextResponse.json(reply);
}

// No server-to-client stream: the specification asks for 405 on GET in that case.
export function GET() {
  return new Response("Matchback MCP server: send JSON-RPC 2.0 requests with POST to this address.", {
    status: 405,
    headers: { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" },
  });
}
