import { NextResponse } from "next/server";
import { clientKey, overBudget } from "@/lib/client";
import { CONSOLE_MODELS } from "@/lib/console-ai";
import { isMerchantRequest } from "@/lib/merchant";

export const runtime = "nodejs";
export const maxDuration = 120;

// Proxy for AG Studio's OpenAI adapter (app/merchant/console/studio/openai-adapter.ts), which runs in
// the browser and POSTs to /api/ai/responses. This adds the Groq key, forwards the body to Groq's
// OpenAI-compatible Responses API and streams the SSE reply back, so the key never leaves the server.
// Verified 2026-10-30: Groq streams, calls strict function tools and accepts function_call_output turns.

const GROQ_RESPONSES_URL = "https://api.groq.com/openai/v1/responses";
const MAX_OUTPUT_TOKENS = 4_000;
// Fields Groq's Responses API does not support (it keeps no server-side state).
const UNSUPPORTED = ["store", "previous_response_id", "include", "truncation", "prompt_cache_key", "safety_identifier", "prompt", "service_tier", "metadata", "user"];

// The console is behind the merchant key; this only keeps one open tab from spending the free tier.
const MAX_PER_MINUTE = 30;

const error = (status: number, message: string) => NextResponse.json({ error: { message } }, { status });

export async function POST(req: Request) {
  if (!isMerchantRequest(req)) return error(401, "Sign in to the store desk first.");
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return error(503, "The assistant is not configured on this server.");
  if (overBudget(`ai:${clientKey(req) ?? "anonymous"}`, MAX_PER_MINUTE, 60_000)) return error(429, "Too many requests to the assistant; wait a minute.");

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return error(400, "Request body must be JSON.");
  }
  const allowed = CONSOLE_MODELS.map((m) => m.id);
  const model = typeof body.model === "string" && allowed.includes(body.model) ? body.model : allowed[0]!;
  for (const field of UNSUPPORTED) delete body[field];

  // Low reasoning effort: reasoning tokens count against the free tier's per-minute budget.
  const payload = JSON.stringify({ ...body, model, max_output_tokens: MAX_OUTPUT_TOKENS, reasoning: { effort: "low" } });
  const send = () =>
    fetch(GROQ_RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: payload,
      // Stopping the chat aborts the browser request, which cancels this one too.
      signal: req.signal,
    });

  let upstream = await send();
  // Over the per-minute budget: wait for the reset Groq reports (if short) and try once more, so a
  // multi-step answer finishes instead of stopping at its last turn.
  if (upstream.status === 429) {
    const wait = Number.parseFloat(upstream.headers.get("retry-after") ?? "");
    if (Number.isFinite(wait) && wait > 0 && wait <= 25) {
      await upstream.text().catch(() => "");
      await new Promise((r) => setTimeout(r, wait * 1000 + 250));
      upstream = await send();
    }
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    console.error("groq responses error", upstream.status, text.slice(0, 600));
    if (upstream.status === 429 || upstream.status === 413) {
      const tooLarge = /request too large|tokens per minute|TPM/i.test(text);
      return error(429, tooLarge
        ? "That request is larger than the free AI tier allows per minute. Pick the faster model, or ask about one claim at a time."
        : "The free AI tier is busy right now; try again in a minute, or pick the faster model.");
    }
    return new Response(text, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" } });
  }
  // Errors come back as JSON and the adapter reads error.message; success is an SSE stream.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" },
  });
}
