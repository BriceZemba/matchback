// The merchant console's AI models: Groq's free tier through its OpenAI-compatible Responses API.
// Only these ids may be requested; the first is the default.

export const CONSOLE_MODELS = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B · Groq" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B · Groq (faster)" },
];

export function consoleAiEnabled(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}
