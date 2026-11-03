import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "@/lib/db";
import { maxRefundShare } from "@/lib/paypal/refunds";
import { autoRefundedOn, loadStoreSettings, parseSettingsForm, releaseAutoRefund, reserveAutoRefund, resetStoreSettings, saveStoreSettings, type StoreSettings } from "@/lib/store-settings";
import { decide, settingsFromEnv, type PolicySettings } from "@/lib/verifier/policy";
import { isKnownRetailer } from "@/lib/verifier/retailers";
import { defaultDeps } from "@/lib/verifier/run";
import { withStoreRules } from "@/lib/guides";

beforeEach(() => resetDbForTests());
afterEach(() => { delete process.env.MATCHBACK_JUDGE_MODE; });

function form(fields: Record<string, string> = {}) {
  const f = new FormData();
  const all = { windowDays: "30", minDiff: "2.50", autoLimit: "25", floorPct: "70", capPct: "40", returnCostPct: "25", stores: "", colorVariants: "on", ...fields };
  for (const [k, v] of Object.entries(all)) if (v !== "absent") f.set(k, v);
  return f;
}

function decision(settings: PolicySettings, competitor = 80) {
  return decide({
    paidCents: 10000, currency: "USD", capturedAt: "2026-11-01T00:00:00Z", now: new Date("2026-11-02T00:00:00Z"),
    competitorDomain: "bestbuy.com", knownRetailer: true, settings,
    offer: { price: { price: competitor, currency: "USD" }, availability: "InStock", condition: "new" } as never,
    identity: { relation: "same_product", method: "channel3_id", evidence: [] } as never,
  });
}

describe("store settings", () => {
  it("falls back to the defaults, then follows what was saved, then resets", async () => {
    expect(await loadStoreSettings()).toEqual({ ...settingsFromEnv(), changedAt: null });

    const parsed = parseSettingsForm(form()) as { settings: StoreSettings };
    await saveStoreSettings(parsed.settings);
    await saveStoreSettings({ ...parsed.settings, windowDays: 45 }); // a second save replaces the row

    const saved = await loadStoreSettings();
    expect(saved).toMatchObject({ windowDays: 45, minDiffCents: 250, autoRefundLimitCents: 2500, floorShare: 0.7, maxRefundShare: 0.4 });
    expect(saved.changedAt).toBeTruthy();
    expect(await maxRefundShare()).toBe(0.4);

    await resetStoreSettings();
    expect((await loadStoreSettings()).windowDays).toBe(14);
  });

  it("in judge mode, forgets a change after 30 minutes", async () => {
    process.env.MATCHBACK_JUDGE_MODE = "1";
    const { settings } = parseSettingsForm(form()) as { settings: StoreSettings };
    await saveStoreSettings(settings);
    expect((await loadStoreSettings()).windowDays).toBe(30);

    await getDb().run("UPDATE store_settings SET updated_at = ?", new Date(Date.now() - 31 * 60_000).toISOString());
    expect((await loadStoreSettings()).windowDays).toBe(14);
  });

  it("refuses values outside the limits", () => {
    expect(parseSettingsForm(form({ windowDays: "0" }))).toEqual({ error: "window" });
    expect(parseSettingsForm(form({ windowDays: "91" }))).toEqual({ error: "window" });
    expect(parseSettingsForm(form({ windowDays: "7.5" }))).toEqual({ error: "window" });
    expect(parseSettingsForm(form({ minDiff: "0" }))).toEqual({ error: "minDiff" });
    expect(parseSettingsForm(form({ minDiff: "1.234" }))).toEqual({ error: "minDiff" });
    expect(parseSettingsForm(form({ autoLimit: "0.50" }))).toEqual({ error: "autoLimit" });
    expect(parseSettingsForm(form({ dailyLimit: "0.50" }))).toEqual({ error: "dailyLimit" });
    expect(parseSettingsForm(form({ dailyLimit: "100000.01" }))).toEqual({ error: "dailyLimit" });
    expect(parseSettingsForm(form({ floorPct: "5" }))).toEqual({ error: "floor" });
    expect(parseSettingsForm(form({ capPct: "100" }))).toEqual({ error: "cap" });
    expect(parseSettingsForm(form({ capPct: "absent" }))).toEqual({ error: "cap" });
    expect(parseSettingsForm(form({ returnCostPct: "0" }))).toEqual({ error: "returnCost" });
    expect(parseSettingsForm(form({ returnCostPct: "101" }))).toEqual({ error: "returnCost" });
  });

  it("reads the optional fields", () => {
    const { settings } = parseSettingsForm(form({ autoLimit: "", colorVariants: "absent" })) as { settings: StoreSettings };
    expect(settings.autoRefundLimitCents).toBeNull();
    expect(settings.dailyAutoLimitCents).toBeNull();
    expect((parseSettingsForm(form({ dailyLimit: "250" })) as { settings: StoreSettings }).settings.dailyAutoLimitCents).toBe(25000);
    expect(settings.allowColorVariants).toBe(false);
    expect(settings.returnCostShare).toBe(0.25);
  });

  it("cleans the store list and refuses resale sites and non-domains", () => {
    const { settings } = parseSettingsForm(form({ stores: "https://www.LocalCamera.com/deals\nshop.example.fr, localcamera.com" })) as { settings: StoreSettings };
    expect(settings.extraRetailers).toEqual(["localcamera.com", "shop.example.fr"]);

    expect(parseSettingsForm(form({ stores: "ebay.com" }))).toEqual({ error: "stores", store: "ebay.com" });
    expect(parseSettingsForm(form({ stores: "not_a_domain" }))).toEqual({ error: "stores", store: "not_a_domain" });
    expect(parseSettingsForm(form({ stores: Array.from({ length: 31 }, (_, i) => `s${i}.com`).join("\n") }))).toEqual({ error: "stores" });
  });

  it("new claims are decided with what the store saved", async () => {
    process.env.CHANNEL3_API_KEY ??= "test-key";
    const { settings } = parseSettingsForm(form()) as { settings: StoreSettings };
    await saveStoreSettings(settings);

    expect((await defaultDeps()).settings).toMatchObject({ windowDays: 30, autoRefundLimitCents: 2500, maxRefundShare: 0.4 });
  });

  it("an added store counts as known", () => {
    expect(isKnownRetailer("localcamera.com", "", [], [])).toBe(false);
    expect(isKnownRetailer("www.localcamera.com", "", [], ["localcamera.com"])).toBe(true);
  });
});

describe("the daily limit on automatic refunds", () => {
  const DAY = "2026-11-03";

  it("counts refunds up to the limit, exactly", async () => {
    expect(await reserveAutoRefund(DAY, 6000, 10000)).toBe(true);
    expect(await reserveAutoRefund(DAY, 4000, 10000)).toBe(true);
    expect(await reserveAutoRefund(DAY, 1, 10000)).toBe(false);
    expect(await autoRefundedOn(DAY)).toBe(10000);
  });

  it("refuses a first refund over the limit, and starts again the next day", async () => {
    expect(await reserveAutoRefund(DAY, 10001, 10000)).toBe(false);
    expect(await autoRefundedOn(DAY)).toBe(0);
    await reserveAutoRefund(DAY, 10000, 10000);
    expect(await reserveAutoRefund("2026-11-04", 10000, 10000)).toBe(true);
  });

  it("never passes the limit when claims arrive together", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveAutoRefund(DAY, 3000, 10000)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await autoRefundedOn(DAY)).toBe(9000);
  });

  it("counts refunds with no limit set, so a limit set later knows the day so far", async () => {
    await reserveAutoRefund(DAY, 8000, null);
    expect(await reserveAutoRefund(DAY, 3000, 10000)).toBe(false);
  });

  it("gives back a refund that never went out", async () => {
    await reserveAutoRefund(DAY, 8000, 10000);
    await releaseAutoRefund(DAY, 8000);
    expect(await autoRefundedOn(DAY)).toBe(0);
    await releaseAutoRefund(DAY, 8000);
    expect(await autoRefundedOn(DAY)).toBe(0);
  });
});

describe("the rules in a decision", () => {
  const base = settingsFromEnv({} as NodeJS.ProcessEnv);

  it("adds nothing with the defaults", () => {
    const d = decision(base);
    expect(d.status).toBe("approved");
    expect(d.refundCents).toBe(2000);
    expect(d.checks.some((c) => c.id === "limit")).toBe(false);
  });

  it("sends a refund over the automatic limit to a person", () => {
    const d = decision({ ...base, autoRefundLimitCents: 1500 });
    expect(d.status).toBe("needs_review");
    expect(d.checks.find((c) => c.id === "limit")).toMatchObject({ outcome: "review" });
    expect(decision({ ...base, autoRefundLimitCents: 2000 }).status).toBe("approved");
  });

  it("sends a gap over the cap to a person, rather than a refund PayPal would never get", () => {
    const d = decision({ ...base, maxRefundShare: 0.1 });
    expect(d.status).toBe("needs_review");
    expect(d.checks.find((c) => c.id === "limit")?.detail).toContain("10%");
  });

  it("still refuses what fails, whatever the limits", () => {
    expect(decision({ ...base, autoRefundLimitCents: 1500, minDiffCents: 5000 }).status).toBe("refused");
    expect(decision({ ...base, windowDays: 1 }, 80).status).toBe("approved");
  });
});

describe("the guides", () => {
  const rules = { windowDays: 30, floorShare: 0.75, minDiffCents: 250 };

  it("state the store's rules in each language's format", () => {
    expect(withStoreRules({ a: "{days} days, {floor}%, {minDiff}", b: ["{days}"] }, "en", rules)).toEqual({ a: "30 days, 75%, $2.50", b: ["30"] });
    expect(withStoreRules({ a: "{minDiff}" }, "fr", rules)).toEqual({ a: "2,50 $" });
    expect(withStoreRules({ a: "{minDiff}" }, "es", rules)).toEqual({ a: "2,50 $" });
  });
});
