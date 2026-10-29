import { describe, expect, it } from "vitest";
import { callTool, LlmUnavailableError, type LlmProvider } from "@/lib/llm";

const tool = { name: "report_identity", description: "d", parameters: { type: "object", properties: {} } };
const groq: LlmProvider = { name: "groq", baseUrl: "https://groq.test/v1", apiKey: "k", model: "m" };
const gemini: LlmProvider = { name: "gemini", baseUrl: "https://gemini.test/v1", apiKey: "k", model: "g" };
const ok = (relation: string) =>
  new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "report_identity", arguments: JSON.stringify({ relation }) } }] } }] }), { status: 200 });
const limited = (resetSeconds: string) => new Response("{}", { status: 429, headers: { "x-ratelimit-reset-tokens": resetSeconds } });

describe("callTool rate limits", () => {
  it("waits for a short token reset and retries the same provider", async () => {
    const calls: string[] = [];
    const responses = [limited("0.05s"), ok("same_product")];
    const fetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return responses.shift()!;
    };
    const out = await callTool<{ relation: string }>("s", "u", tool, { providers: [groq, gemini], fetch });
    expect(out.provider).toBe("groq");
    expect(calls.every((u) => u.startsWith("https://groq.test"))).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("falls through to the next provider when the reset is too long", async () => {
    const fetch: typeof globalThis.fetch = async (input) => (String(input).startsWith("https://groq.test") ? limited("45s") : ok("cannot_tell"));
    const out = await callTool<{ relation: string }>("s", "u", tool, { providers: [groq, gemini], fetch, maxRateLimitWaitMs: 1000 });
    expect(out.provider).toBe("gemini");
  });

  it("retries once when the model garbled the tool name (tool_use_failed)", async () => {
    const responses = [new Response(JSON.stringify({ error: { code: "tool_use_failed" } }), { status: 400 }), ok("same_product")];
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => { calls++; return responses.shift()!; };
    const out = await callTool<{ relation: string }>("s", "u", tool, { providers: [groq], fetch });
    expect(out.provider).toBe("groq");
    expect(calls).toBe(2);
  });

  it("reports unavailable when every provider is limited", async () => {
    const fetch: typeof globalThis.fetch = async () => limited("45s");
    await expect(callTool("s", "u", tool, { providers: [groq, gemini], fetch, maxRateLimitWaitMs: 1000 })).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});
