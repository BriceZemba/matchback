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
  dailyLimitDollars: { min: 1, max: 100_000 },
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

// Refunds paid without a person, counted per UTC day. The check and the addition are one statement, so
// claims verified at the same moment on different server instances cannot pass the limit together.

export const utcDay = (at: Date) => at.toISOString().slice(0, 10);

/** Count an automatic refund against the day. False: it would pass the limit, and nothing was counted. */
export async function reserveAutoRefund(day: string, cents: number, limitCents: number | null): Promise<boolean> {
  if (limitCents !== null && cents > limitCents) return false;
  const add = "INSERT INTO auto_refund_days (day, cents) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET cents = auto_refund_days.cents + excluded.cents";
  const { changes } = limitCents === null
    ? await getDb().run(add, day, cents)
    : await getDb().run(`${add} WHERE auto_refund_days.cents + excluded.cents <= ?`, day, cents, limitCents);
  return changes === 1;
}

/** Give back what a refund that never went out had counted. */
export async function releaseAutoRefund(day: string, cents: number): Promise<void> {
  await getDb().run("UPDATE auto_refund_days SET cents = cents - ? WHERE day = ? AND cents >= ?", cents, day, cents);
}

export async function autoRefundedOn(day: string): Promise<number> {
  const row = await getDb().get("SELECT cents FROM auto_refund_days WHERE day = ?", day) as { cents: number | string } | undefined;
  return Number(row?.cents ?? 0);
}

export type SettingsProblem = { error: "window" | "minDiff" | "autoLimit" | "dailyLimit" | "floor" | "cap" | "returnCost" | "stores"; store?: string };

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
  const dailyLimit = text("dailyLimit");
  const dailyAutoLimitCents = dailyLimit === "" ? null : cents(dailyLimit, L.dailyLimitDollars);
  if (dailyLimit !== "" && dailyAutoLimitCents === null) return { error: "dailyLimit" };
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
      dailyAutoLimitCents,
      extraRetailers: [...new Set(stores)],
      returnCostShare: returnCostPct / 100,
    },
  };
}
