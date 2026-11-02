import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { judgeMode } from "@/lib/judge";
import { requestPrefs } from "@/lib/locale-server";
import { isMerchantSession, merchantKey, MERCHANT_COOKIE } from "@/lib/merchant";
import { fromCents } from "@/lib/money";
import { loadStoreSettings, SETTING_LIMITS as L } from "@/lib/store-settings";
import { SubmitButton } from "../../submit-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Matchback · store settings" };

// The rules a store owner controls. Applied to new claims; decisions already made stay as they are.
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!merchantKey()) notFound();
  if (!isMerchantSession((await cookies()).get(MERCHANT_COOKIE)?.value)) redirect("/merchant");
  const q = await searchParams;
  const { t, locale } = await requestPrefs();
  const m = t.merchant;
  const s = m.settings;
  const current = await loadStoreSettings();
  const error = q.error === "stores" ? s.errors.stores(q.store ?? "") : q.error ? s.errors[q.error as keyof typeof s.errors] : undefined;

  return (
    <main className="shell merchant">
      <div className="page-head">
        <a className="back" href="/merchant">{s.back}</a>
        <h1 className="rise">{s.title}</h1>
        <p className="muted" style={{ maxWidth: 640 }}>{s.lede}</p>
        {judgeMode() && <p className="subtle" style={{ margin: 0 }}>{s.judgeNote}</p>}
      </div>

      {q.done === "saved" && <p className="notice" role="status">{s.saved}</p>}
      {q.done === "reset" && <p className="notice" role="status">{s.wasReset}</p>}
      {typeof error === "string" && <p className="notice notice-warn" role="alert">{error}</p>}

      <form className="card card-pad settings-form" method="post" action="/api/merchant/settings">
        <Field name="windowDays" label={s.windowDays} hint={s.windowDaysHint} unit={s.days} value={current.windowDays} min={L.windowDays.min} max={L.windowDays.max} step={1} />
        <Field name="minDiff" label={s.minDiff} hint={s.minDiffHint} unit="$" value={fromCents(current.minDiffCents)} min={L.minDiffDollars.min} max={L.minDiffDollars.max} step={0.01} />
        <Field name="autoLimit" label={s.autoLimit} hint={s.autoLimitHint} unit="$" value={current.autoRefundLimitCents === null ? "" : fromCents(current.autoRefundLimitCents)} min={L.autoLimitDollars.min} max={L.autoLimitDollars.max} step={0.01} optional placeholder={s.noLimit} />
        <Field name="capPct" label={s.cap} hint={s.capHint} unit="%" value={Math.round(current.maxRefundShare * 100)} min={L.capPct.min} max={L.capPct.max} step={1} />
        <Field name="floorPct" label={s.floor} hint={s.floorHint} unit="%" value={Math.round(current.floorShare * 100)} min={L.floorPct.min} max={L.floorPct.max} step={1} />

        <label className="settings-check">
          <input type="checkbox" name="colorVariants" defaultChecked={current.allowColorVariants} />
          <span><strong>{s.colorVariants}</strong><br /><span className="subtle">{s.colorVariantsHint}</span></span>
        </label>

        <div className="field">
          <label htmlFor="stores">{s.stores}</label>
          <textarea id="stores" name="stores" className="input settings-stores" rows={3} defaultValue={current.extraRetailers.join("\n")} placeholder="localcamera.com" />
          <p className="subtle" style={{ margin: 0 }}>{s.storesHint}</p>
        </div>

        <div className="review-actions">
          <SubmitButton pendingLabel={s.saving} className="btn btn-accent">{s.save}</SubmitButton>
          <SubmitButton pendingLabel={s.resetting} className="btn btn-ghost" formAction="/api/merchant/settings?reset=1" noValidate>{s.reset}</SubmitButton>
        </div>
        {current.changedAt && (
          <p className="subtle" style={{ margin: "12px 0 0" }}>
            {s.changedAt(new Date(current.changedAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC")}
          </p>
        )}
      </form>
    </main>
  );
}

function Field({ name, label, hint, unit, value, min, max, step, optional = false, placeholder }: {
  name: string; label: string; hint: string; unit: string; value: string | number; min: number; max: number; step: number; optional?: boolean; placeholder?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <div className="settings-input">
        <input id={name} name={name} className="input mono" type="number" inputMode="decimal" defaultValue={value} min={min} max={max} step={step} required={!optional} placeholder={placeholder} />
        <span className="mono subtle">{unit}</span>
      </div>
      <p className="subtle" style={{ margin: 0 }}>{hint}</p>
    </div>
  );
}
