// One OpenAI-compatible chat client over free tiers: Groq first, Gemini as fallback (LLM_PRIMARY can swap
// them). Used only through forced tool calls, so the model returns structured JSON and code decides.

export type LlmProvider = { name: string; baseUrl: string; apiKey: string; model: string };

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

/** A user message: plain text, or OpenAI-style parts when an image is attached. */
export type UserContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

export class LlmUnavailableError extends Error {}

export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider[] {
  const groq = env.GROQ_API_KEY
    ? { name: "groq", baseUrl: env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1", apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL ?? "openai/gpt-oss-120b" }
    : undefined;
  const gemini = env.GEMINI_API_KEY
    ? { name: "gemini", baseUrl: env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL ?? "gemini-3.5-flash" }
    : undefined;
  const ordered = env.LLM_PRIMARY === "gemini" ? [gemini, groq] : [groq, gemini];
  return ordered.filter((p): p is LlmProvider => Boolean(p));
}

/** Providers that accept images: Groq's Qwen vision model first, Gemini Flash as fallback. */
export function visionProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider[] {
  return providersFromEnv(env).map((p) =>
    p.name === "groq" ? { ...p, model: env.GROQ_VISION_MODEL ?? "qwen/qwen3.8-27b" } : p,
  );
}

/** Call the tool on the first provider that answers; returns the parsed arguments and who answered. */
export async function callTool<T>(
  system: string,
  user: UserContent,
  tool: ToolSpec,
  opts: { providers?: LlmProvider[]; fetch?: typeof fetch; timeoutMs?: number; maxRateLimitWaitMs?: number } = {},
): Promise<{ args: T; provider: string; model: string }> {
  const providers = opts.providers ?? providersFromEnv();
  const doFetch = opts.fetch ?? fetch;
  const failures: string[] = [];
  const maxWaitMs = opts.maxRateLimitWaitMs ?? 20_000;
  for (const p of providers) {
    try {
      const send = () =>
        doFetch(`${p.baseUrl.replace(/\/?$/, "/")}chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: p.model,
            temperature: 0,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            tools: [{ type: "function", function: tool }],
            tool_choice: "required",
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
        });
      let res = await send();
      // Free tiers rate-limit by tokens per minute (Groq: 8,000). A short wait beats sending the claim
      // to a person; a long one falls through to the next provider.
      if (res.status === 429) {
        const reset = Number.parseFloat(res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-reset-tokens") ?? "");
        const waitMs = Number.isFinite(reset) ? reset * 1000 + 250 : maxWaitMs + 1;
        if (waitMs <= maxWaitMs) {
          await new Promise((r) => setTimeout(r, waitMs));
          res = await send();
        }
      }
      // Groq rejects a call whose tool name the model garbled ("tool_use_failed"); one retry usually fixes it.
      if (res.status === 400) {
        const text = await res.clone().text();
        if (text.includes("tool_use_failed")) res = await send();
      }
      if (!res.ok) {
        failures.push(`${p.name}: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] };
      const call = data.choices?.[0]?.message?.tool_calls?.find((c) => c.function?.name === tool.name);
      if (!call?.function?.arguments) {
        failures.push(`${p.name}: no tool call`);
        continue;
      }
      return { args: JSON.parse(call.function.arguments) as T, provider: p.name, model: p.model };
    } catch (err) {
      failures.push(`${p.name}: ${err instanceof Error ? err.name : "error"}`);
    }
  }
  throw new LlmUnavailableError(`no LLM provider answered (${failures.join("; ") || "none configured"})`);
}
