import { getDb, now } from "@/lib/db";
import { judgeMode } from "@/lib/judge";
import { toCents } from "@/lib/money";
import { isResaleDomain, settingsFromEnv } from "@/lib/verifier/policy";

// The rules a store owner sets on /merchant/settings: one row, read for every new decision, so all server
// instances agree. No row means the defaults from the environment. Decisions already made do not change.

export type StoreSettings = ReturnType<typeof settingsFromEnv>;

export const SETTING_LIMITS = {
  windowDays: { min: 1, max: 90 },
  minDiffDollars: { min: 0.01, max: 100 },
  autoLimitDollars: { min: 1, max: 1000 },
  floorPct: { min: 10, max: 95 },
  capPct: { min: 5, max: 90 },
  returnCostPct: { min: 1, max: 100 },
  stores: { max: 30 },
};

/** The judges share one merchant key, so one judge's experiment must not change the next judge's run. */
const JUDGE_CHANGES_LAST_MS = 30 * 60_000;

type Row = { json: string; updated_at: string };

export async function loadStoreSettings(): Promise<StoreSettings & { changedAt: string | null }> {
  const defaults = settingsFromEnv();
  const row = await getDb().get("SELECT json, updated_at FROM store_settings WHERE id = 'store'") as Row | undefined;
  if (!row || (judgeMode() && Date.now() - Date.parse(row.updated_at) > JUDGE_CHANGES_LAST_MS)) return { ...defaults, changedAt: null };
  return { ...defaults, ...(JSON.parse(row.json) as Partial<StoreSettings>), changedAt: row.updated_at };
}

export async function saveStoreSettings(settings: StoreSettings): Promise<void> {
  await getDb().run(
    "INSERT INTO store_settings (id, json, updated_at) VALUES ('store', ?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
    JSON.stringify(settings), now(),
  );
}

export async function resetStoreSettings(): Promise<void> {
  await getDb().run("DELETE FROM store_settings WHERE id = 'store'");
}

export type SettingsProblem = { error: "window" | "minDiff" | "autoLimit" | "floor" | "cap" | "returnCost" | "stores"; store?: string };

const whole = (v: string, { min, max }: { min: number; max: number }) => (/^\d+$/.test(v) && Number(v) >= min && Number(v) <= max ? Number(v) : null);
const cents = (v: string, { min, max }: { min: number; max: number }) => {
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const c = toCents(v);
  return c >= Math.round(min * 100) && c <= max * 100 ? c : null;
};

/** The form as typed, checked again here: the browser's own limits can be skipped. */
export function parseSettingsForm(form: FormData): { settings: StoreSettings } | SettingsProblem {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const L = SETTING_LIMITS;

  const windowDays = whole(text("windowDays"), L.windowDays);
  if (windowDays === null) return { error: "window" };
  const minDiffCents = cents(text("minDiff"), L.minDiffDollars);
  if (minDiffCents === null) return { error: "minDiff" };
  const autoLimit = text("autoLimit");
  const autoRefundLimitCents = autoLimit === "" ? null : cents(autoLimit, L.autoLimitDollars);
  if (autoLimit !== "" && autoRefundLimitCents === null) return { error: "autoLimit" };
  const floorPct = whole(text("floorPct"), L.floorPct);
  if (floorPct === null) return { error: "floor" };
  const capPct = whole(text("capPct"), L.capPct);
  if (capPct === null) return { error: "cap" };
  const returnCostPct = whole(text("returnCostPct"), L.returnCostPct);
  if (returnCostPct === null) return { error: "returnCost" };

  const stores = text("stores").split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""));
  const bad = stores.find((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) || isResaleDomain(d));
  if (bad !== undefined) return { error: "stores", store: bad.slice(0, 80) };
  if (stores.length > L.stores.max) return { error: "stores" };

  return {
    settings: {
      windowDays,
      minDiffCents,
      floorShare: floorPct / 100,
      allowColorVariants: form.get("colorVariants") !== null,
      maxRefundShare: capPct / 100,
      autoRefundLimitCents,
      extraRetailers: [...new Set(stores)],
      returnCostShare: returnCostPct / 100,
    },
  };
}
