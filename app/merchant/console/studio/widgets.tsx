"use client";

// Matchback's own AG Studio widgets. Each reads through Studio's data engine (widgetApi.getData), so
// page filters and cross-filters from other widgets apply, and each is drawn in the site's receipt style.
//   - Money kept: the guarantee's P&L as a receipt, against what full returns would have refunded.
//   - Decision trail: the checks behind the claims in view, stamped passed / failed / needs a person.
//   - Review queue: claims waiting for a person, with Approve and Refuse wired to the store desk's
//     guarded PayPal refund. The console reloads its data after each decision.

import { useEffect, useRef, useState } from "react";
import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { createWidgets } from "ag-studio-react";

// The console and its widgets talk through window events: a widget that changed data asks the console
// to reload rows from the server, and the console tells widgets when fresh rows are in Studio.
export const DATA_CHANGED = "matchback:data-changed";
export const DATA_RELOADED = "matchback:data-reloaded";

type Rows = Record<string, unknown>[];

/** Fetch the widget's mapped fields through Studio, with the usual display states. */
function useWidgetRows(params: AgWidgetParams, keys: string[]): { rows: Rows | null; fields: Record<string, AgWidgetField | undefined> } {
  const fields = Object.fromEntries(keys.map((k) => [k, (params.dataMapping as Record<string, AgWidgetField[] | undefined>)[k]?.[0]]));
  const [rows, setRows] = useState<Rows | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    const reloaded = () => setDataVersion((v) => v + 1);
    window.addEventListener(DATA_RELOADED, reloaded);
    return () => window.removeEventListener(DATA_RELOADED, reloaded);
  }, []);
  const signature = JSON.stringify([dataVersion, Object.values(fields).map((f) => f && [f.key, f.fieldId, f.aggregation])]);
  useEffect(() => {
    const mapped = Object.values(fields).filter((f): f is AgWidgetField => Boolean(f));
    if (mapped.length < keys.length) {
      params.widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    const controller = new AbortController();
    params.widgetApi.setDisplayState("loading");
    params.widgetApi
      .getData({ kind: "flat", fields: mapped }, { signal: controller.signal })
      .then((res) => {
        const r = res.results.rows ?? [];
        setRows(r);
        params.widgetApi.setDisplayState(r.length ? "displayed" : "noData");
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.error("widget data failed", err);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, params.widgetApi]);
  return { rows, fields };
}

const value = (row: Record<string, unknown> | undefined, f: AgWidgetField | undefined) => (row && f ? row[f.key] : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// --- Money kept --------------------------------------------------------------------

function MoneyKept(params: AgWidgetParams) {
  const { rows, fields } = useWidgetRows(params, ["claimed", "refunded", "kept"]);
  const row = rows?.[0];
  const claimed = num(value(row, fields.claimed));
  const refunded = num(value(row, fields.refunded));
  const kept = num(value(row, fields.kept));
  const share = claimed > 0 ? Math.round((kept / claimed) * 100) : 0;
  return (
    <div className="cw cw-receipt">
      <div className="cw-receipt-head"><strong>Matchback</strong><span>Price-match P&amp;L</span></div>
      <dl>
        <dt>Claimed sales</dt><dd>{usd(claimed)}</dd>
        <dt>Refunded (the difference)</dt><dd>−{usd(refunded)}</dd>
        <dt className="cw-total">Sales kept</dt><dd className="cw-total">{usd(kept)}</dd>
      </dl>
      <p className="cw-note">A full return on the same orders would have refunded {usd(claimed)} and brought the products back.</p>
      {claimed > 0 && <span className="cw-stamp ok">Kept {share}%</span>}
    </div>
  );
}

// --- Decision trail ----------------------------------------------------------------

const ORDER = ["Passed", "Needs a person", "Failed"];

function DecisionTrail(params: AgWidgetParams) {
  const { rows, fields } = useWidgetRows(params, ["check", "outcome", "count"]);
  const byCheck = new Map<string, Record<string, number>>();
  for (const r of rows ?? []) {
    const check = String(value(r, fields.check) ?? "");
    const outcome = String(value(r, fields.outcome) ?? "");
    const entry = byCheck.get(check) ?? {};
    entry[outcome] = (entry[outcome] ?? 0) + num(value(r, fields.count));
    byCheck.set(check, entry);
  }
  const checks = [...byCheck.entries()].sort((a, b) => (b[1].Failed ?? 0) + (b[1]["Needs a person"] ?? 0) - ((a[1].Failed ?? 0) + (a[1]["Needs a person"] ?? 0)));
  return (
    <div className="cw cw-trail">
      {checks.map(([check, counts]) => (
        <div key={check} className="cw-trail-row">
          <span className="cw-trail-name">{check}</span>
          <span className="cw-trail-chips">
            {ORDER.filter((o) => counts[o]).map((o) => (
              <span key={o} className={`cw-chip ${o === "Passed" ? "ok" : o === "Failed" ? "no" : "wait"}`} title={o}>
                {o === "Passed" ? "✓" : o === "Failed" ? "✕" : "?"} {counts[o]}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Review queue ------------------------------------------------------------------

type Decision = { state: "idle" | "busy" | "done" | "error"; message?: string };

async function decide(claimId: string, action: "approve" | "refuse", form: { amount?: string; note: string }): Promise<{ ok: boolean; message: string }> {
  const body = new FormData();
  if (form.amount !== undefined) body.set("amount", form.amount);
  body.set("note", form.note);
  // The store-desk route answers JSON when asked for it (a form post gets a redirect instead).
  const res = await fetch(`/api/merchant/claims/${encodeURIComponent(claimId)}/${action}`, {
    method: "POST", body, credentials: "same-origin", headers: { Accept: "application/json" },
  });
  if (res.status === 401) return { ok: false, message: "Sign in to the store desk again." };
  const json = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
  if (json.error) return { ok: false, message: json.error };
  const status = json.status ?? "";
  return {
    ok: status === "refunded" || status === "refused",
    message: status === "refunded" ? "Refunded through PayPal." : status === "refused" ? "Refused; the shopper's receipt says so." : status === "refund_failed" ? "Approved, but the refund did not go through." : `Saved (${status}).`,
  };
}

/**
 * A button whose click listener is attached to the element itself. Studio stops events on their way up
 * through a widget, so React's root-level listener never sees them; a native listener does.
 */
function NativeButton({ onPress, disabled, className, children }: { onPress: () => void; disabled?: boolean; className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const handler = useRef(onPress);
  handler.current = onPress;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: Event) => {
      e.stopPropagation();
      handler.current();
    };
    el.addEventListener("click", listener);
    return () => el.removeEventListener("click", listener);
  }, []);
  return <button ref={ref} type="button" className={className} disabled={disabled}>{children}</button>;
}

function QueueItem({ row, fields }: { row: Record<string, unknown>; fields: Record<string, AgWidgetField | undefined> }) {
  const id = String(value(row, fields.claim));
  const paid = num(value(row, fields.paid));
  const offerRaw = value(row, fields.offer);
  const offer = offerRaw === null || offerRaw === undefined ? null : num(offerRaw);
  const suggested = offer !== null && offer < paid ? (paid - offer).toFixed(2) : "";
  const amountRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const [d, setD] = useState<Decision>({ state: "idle" });

  // Inputs are read when a button is pressed (their own events may not reach React either).
  const act = async (action: "approve" | "refuse") => {
    setD({ state: "busy" });
    const note = noteRef.current?.value ?? "";
    const result = await decide(id, action, action === "approve" ? { amount: amountRef.current?.value ?? "", note } : { note });
    setD({ state: result.ok ? "done" : "error", message: result.message });
    if (result.ok) setTimeout(() => window.dispatchEvent(new Event(DATA_CHANGED)), 900);
  };

  return (
    <article className={`cw-queue-item ${d.state}`}>
      <header>
        <strong>{String(value(row, fields.product) ?? "")}</strong>
        <a href={`/claims/${id}`} target="_blank" rel="noreferrer">Receipt ↗</a>
      </header>
      <p className="cw-queue-facts">
        Paid {usd(paid)} · {offer === null ? "offer not read" : `${usd(offer)} at ${String(value(row, fields.store) ?? "")}`}
      </p>
      <p className="cw-queue-why">{String(value(row, fields.reason) ?? "")}</p>
      {d.state === "done" ? (
        <p className="cw-queue-result ok">{d.message}</p>
      ) : (
        <div className="cw-queue-form">
          <label>Refund $<input ref={amountRef} inputMode="decimal" defaultValue={suggested} placeholder="0.00" /></label>
          <input ref={noteRef} className="cw-note-input" placeholder="Note to the shopper (optional)" maxLength={300} />
          <NativeButton className="cw-btn approve" disabled={d.state === "busy"} onPress={() => void act("approve")}>{d.state === "busy" ? "Working…" : "Approve & refund"}</NativeButton>
          <NativeButton className="cw-btn" disabled={d.state === "busy"} onPress={() => void act("refuse")}>Refuse</NativeButton>
          {d.state === "error" && <p className="cw-queue-result no">{d.message}</p>}
        </div>
      )}
    </article>
  );
}

function ReviewQueue(params: AgWidgetParams) {
  const { rows, fields } = useWidgetRows(params, ["claim", "status", "product", "store", "paid", "offer", "reason"]);
  const queue = (rows ?? []).filter((r) => value(r, fields.status) === "needs_review");
  if (rows && queue.length === 0) return <div className="cw cw-empty">Nothing waiting for review. Every claim in view was decided.</div>;
  return (
    <div className="cw cw-queue">
      {queue.map((r) => <QueueItem key={String(value(r, fields.claim))} row={r} fields={fields} />)}
    </div>
  );
}

// --- Registration ------------------------------------------------------------------

const numeric = { type: "field" as const, supportedRoles: ["numeric" as const], requires: { cardinality: "one" as const }, required: true };
const category = { type: "field" as const, supportedRoles: ["category" as const], requires: { cardinality: "one" as const }, required: true };

const moneyKept = {
  id: "matchback-money-kept",
  label: "Money kept",
  dataMapping: { claimed: numeric, refunded: numeric, kept: numeric },
  form: (p: { createDefaults: (o: object) => unknown }) => p.createDefaults({ dataMappingItems: [{ key: "claimed", label: "Claimed sales" }, { key: "refunded", label: "Refunded" }, { key: "kept", label: "Sales kept" }] }),
  comp: MoneyKept,
  defaultSize: { width: 380, height: 300 },
  minSize: { width: 260, height: 220 },
  ai: { description: "The price-match guarantee's P&L as a receipt: claimed sales, refunds, sales kept, compared with full returns." },
};

const decisionTrail = {
  id: "matchback-decision-trail",
  label: "Decision trail",
  dataMapping: { check: category, outcome: category, count: numeric },
  form: (p: { createDefaults: (o: object) => unknown }) => p.createDefaults({ dataMappingItems: [{ key: "check", label: "Check" }, { key: "outcome", label: "Outcome" }, { key: "count", label: "Count" }] }),
  comp: DecisionTrail,
  defaultSize: { width: 380, height: 360 },
  minSize: { width: 260, height: 200 },
  ai: { description: "The checks behind the claims in view, each stamped passed, failed or needs a person, worst first." },
};

const reviewQueue = {
  id: "matchback-review-queue",
  label: "Review queue",
  dataMapping: { claim: category, status: category, product: category, store: category, paid: numeric, offer: numeric, reason: category },
  form: (p: { createDefaults: (o: object) => unknown }) => p.createDefaults({
    dataMappingItems: [
      { key: "claim", label: "Claim ID" }, { key: "status", label: "Status code" }, { key: "product", label: "Product" }, { key: "store", label: "Store" },
      { key: "paid", label: "Price paid" }, { key: "offer", label: "Competitor price" }, { key: "reason", label: "Reason" },
    ],
  }),
  comp: ReviewQueue,
  defaultSize: { width: 900, height: 480 },
  minSize: { width: 360, height: 240 },
  ai: { description: "Claims waiting for a person, with Approve (refund through PayPal) and Refuse. Only a person's click decides." },
};

const MATCHBACK_IDS = ["matchback-money-kept", "matchback-decision-trail", "matchback-review-queue"];
const registered = createWidgets({ additionalTypes: [moneyKept, decisionTrail, reviewQueue] } as never);

/** For AgStudio's `widgets` prop: Studio's widgets plus ours, with a "Matchback" group first in the menu. */
export const matchbackWidgets = (defaults: { menu: { label: string; widgetIds: readonly string[] }[] }) =>
  ({ ...registered, menu: [{ label: "Matchback", widgetIds: MATCHBACK_IDS }, ...defaults.menu] }) as never;
