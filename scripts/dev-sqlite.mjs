// Local dev server on the SQLite database, even when .env has a DATABASE_URL (the hosted database).
// An empty DATABASE_URL in the environment wins over .env. Run: node scripts/dev-sqlite.mjs [port]
import { spawn } from "node:child_process";

const port = process.env.PORT ?? process.argv[2] ?? "3001";
spawn("npx", ["next", "dev", "-p", port], { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, DATABASE_URL: "" } })
  .on("exit", (code) => process.exit(code ?? 0));
