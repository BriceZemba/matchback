// Runs once when the server starts. With MATCHBACK_WATCH_INTERVAL_MIN set, the price watch checks every
// paid order in its claim window on that schedule (first pass one minute after boot).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const minutes = Number(process.env.MATCHBACK_WATCH_INTERVAL_MIN ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  const { watchAll } = await import("@/lib/watch");
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const results = await watchAll();
      const found = results.filter((r) => r.outcome === "found").length;
      console.log(`price watch: ${results.length} order(s) checked, ${found} with a verified price drop`);
    } catch (err) {
      console.error("price watch failed", err);
    } finally {
      running = false;
    }
  };
  setTimeout(pass, 60_000);
  setInterval(pass, minutes * 60_000);
}
