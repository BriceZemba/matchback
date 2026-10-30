// Copies the secret settings from .env to the Vercel project (production) as "sensitive" variables.
// Values are piped straight to the Vercel CLI and never printed. Run it yourself:
//   node scripts/vercel-push-secrets.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const KEYS = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "CHANNEL3_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "DATABASE_URL", "CRON_SECRET", "MERCHANT_KEY", "AG_STUDIO_LICENSE"];
const SCOPE = "the-second";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);

let failed = 0;
for (const key of KEYS) {
  const value = env[key];
  if (!value) {
    console.log(`${key}: missing in .env, skipped`);
    failed++;
    continue;
  }
  const res = spawnSync("npx", ["vercel", "env", "add", key, "production", "--sensitive", "--force", "--scope", SCOPE], {
    input: value,
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (res.status === 0) console.log(`${key}: set`);
  else {
    failed++;
    console.log(`${key}: FAILED (${(res.stderr || "").split("\n").find((l) => l.includes("Error")) ?? "see vercel output"})`);
  }
}
console.log(failed ? `${failed} problem(s) above.` : "All secrets are on Vercel.");
process.exit(failed ? 1 : 0);
