// The console's starting report: an overview of the guarantee, the claims themselves, and the stores
// and products behind them. Field ids ("claims.outcome") refer to the data sources in ./data.ts.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";

// Position on the canvas grid, in tracks: 24 columns wide, rows of studioCanvasRowHeight.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string, subtitle?: string) => ({
  title: { enabled: true, text },
  ...(subtitle && { subtitle: { enabled: true, text: subtitle } }),
});
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const countd = (id: string) => ({ id, aggregation: "countd" as const });
// Matchback's own widgets (./widgets.tsx) are not in Studio's built-in widget types.
const custom = (widget: { type: string; dataMapping: object; format: object }) => widget as never;

const typography = (fontSize: number, fontWeight: "normal" | "bold" = "normal") => ({
  fontFamily: "var(--mono)",
  fontSize,
  fontWeight,
  fontStyle: "normal" as const,
});

const kpi = (text: string, value: { id: string; aggregation?: "sum" | "countd" }, sparklineX?: string) => ({
  type: "value" as const,
  dataMapping: { value: [value], ...(sparklineX && { sparklineX: [{ id: sparklineX }] }) },
  format: {
    title: { enabled: true, text, typography: typography(12, "bold") },
    caption: { enabled: true, text: "", typography: typography(0) },
    style: { typography: typography(22) },
  },
});

const overview: AgPageState = {
  id: "overview",
  widgets: {
    "kpi-claims": kpi("Claims", countd("claims.id"), "calendar::day"),
    "kpi-refunded": kpi("Refunded", sum("refunds.amount"), "calendar::day"),
    "kpi-kept": kpi("Sales kept", sum("orders.keptSale")),
    "kpi-auto": kpi("Automatic", { id: "automaticShare" }),
    "kpi-review": kpi("With a person", sum("claims.isReview")),
    "claim-date": {
      type: "date-filter",
      dataMapping: { value: [{ id: "claims.day" }] },
      format: { style: { filterType: "relative" } },
    },
    "outcomes-by-day": {
      type: "column-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "claims.day" }],
        valueKey: [sum("claims.isRefunded"), sum("claims.isRefused"), sum("claims.isReview")],
      },
      format: { ...title("Claims per day", "Refunded, refused, or with a person"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    outcomes: {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "claims.outcome" }], valueKey: [countd("claims.id")] },
      format: title("Outcomes"),
    },
    "money-kept": custom({
      type: "matchback-money-kept",
      dataMapping: { claimed: [sum("orders.claimedSale")], refunded: [sum("orders.refunded")], kept: [sum("orders.keptSale")] },
      format: title("Money kept", "Refund the difference, keep the sale"),
    }),
    "kept-vs-refunded": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "products.product" }], valueKey: [sum("orders.keptSale"), sum("orders.refunded")] },
      format: { ...title("Sales kept vs refunded, per product", "A refund of the difference instead of a full return"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "claimed-with": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "claims.source" }], valueKey: [countd("claims.id")] },
      format: title("Claimed with"),
    },
  },
  widgetLayout: {
    "kpi-claims": at(0, 0, 4, 7),
    "kpi-refunded": at(4, 0, 5, 7),
    "kpi-kept": at(9, 0, 5, 7),
    "kpi-auto": at(14, 0, 5, 7),
    "kpi-review": at(19, 0, 5, 7),
    "outcomes-by-day": at(0, 7, 15, 17),
    "money-kept": at(15, 7, 9, 17),
    "kept-vs-refunded": at(0, 24, 12, 18),
    outcomes: at(12, 24, 6, 18),
    "claimed-with": at(18, 24, 6, 18),
    "claim-date": at(0, 42, 8, 6),
  },
};

const claims: AgPageState = {
  id: "claims",
  widgets: {
    outcome: {
      type: "button-filter",
      dataMapping: { value: [{ id: "claims.outcome" }] },
      format: { ...title("Outcome"), style: { selection: { type: "multiple" }, dimensions: { height: 28, minWidth: 48 } } },
    },
    "claims-grid": {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "claims.createdAt" },
          { id: "claims.product" },
          { id: "claims.store" },
          { id: "claims.outcome" },
          { id: "claims.reason" },
          sum("claims.paid"),
          sum("claims.offerPrice"),
          sum("claims.gap"),
          sum("claims.refunded"),
          { id: "claims.decidedBy" },
          { id: "claims.source" },
        ],
      },
      sort: [{ field: { id: "claims.createdAt" }, direction: "desc" }],
      format: title("Every claim", "Newest first; click a row to filter the page"),
    },
    "why-not-paid": {
      type: "bar-chart-stacked",
      dataMapping: { categoryKey: [{ id: "checks.check" }], valueKey: [sum("checks.isFail"), sum("checks.isReview")] },
      format: { ...title("Why claims were not paid automatically", "Checks that failed, or needed a person"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "decision-trail": custom({
      type: "matchback-decision-trail",
      dataMapping: { check: [{ id: "checks.check" }], outcome: [{ id: "checks.outcome" }], count: [countd("checks.id")] },
      format: title("Decision trail", "The checks behind the claims in view"),
    }),
    "ai-verdicts": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "claims.aiRelation" }], valueKey: [countd("claims.id")] },
      format: title("AI identity verdicts", "When the listing was not the catalogue product"),
    },
  },
  widgetLayout: {
    outcome: at(0, 0, 24, 5),
    "claims-grid": at(0, 5, 16, 22),
    "decision-trail": at(16, 5, 8, 22),
    "why-not-paid": at(0, 27, 14, 18),
    "ai-verdicts": at(14, 27, 10, 18),
  },
};

const stores: AgPageState = {
  id: "stores",
  widgets: {
    "by-store": {
      type: "bar-chart-stacked",
      dataMapping: { categoryKey: [{ id: "claims.store" }], valueKey: [sum("claims.isRefunded"), sum("claims.isRefused"), sum("claims.isReview")] },
      format: { ...title("Claims per competitor store"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "store-types": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "stores.storeType" }], valueKey: [countd("stores.id")] },
      format: title("Store types", "Number of stores the rules know"),
    },
    "known-stores": {
      type: "grid",
      dataMapping: { cols: [{ id: "stores.id" }, { id: "stores.storeType" }, sum("stores.claims")] },
      sort: [{ field: sum("stores.claims"), direction: "desc" }],
      format: title("Stores the rules know", "Listed and added stores can be paid; resale is refused; any other shop goes to a person"),
    },
    products: {
      type: "grid",
      dataMapping: { cols: [{ id: "products.product" }, countd("claims.id"), sum("claims.refunded"), sum("claims.isRefused")] },
      sort: [{ field: countd("claims.id"), direction: "desc" }],
      format: title("Products drawing claims"),
    },
    findings: {
      type: "grid",
      dataMapping: { cols: [{ id: "findings.day" }, { id: "findings.store" }, sum("findings.price"), sum("findings.refund"), { id: "findings.status" }] },
      sort: [{ field: { id: "findings.day" }, direction: "desc" }],
      format: title("Price watch finds", "Verified drops offered to shoppers"),
    },
  },
  widgetLayout: {
    "by-store": at(0, 0, 15, 20),
    "store-types": at(15, 0, 9, 20),
    products: at(0, 20, 12, 20),
    findings: at(12, 20, 12, 20),
    "known-stores": at(0, 40, 24, 22),
  },
};

// The evaluation set: real listings on frozen data, kept apart from the live numbers on the other pages.
const evaluation: AgPageState = {
  id: "evaluation",
  widgets: {
    "kpi-traps": kpi("Traps tested", sum("evaluation.isTrap")),
    "kpi-mb-paid": kpi("Paid by Matchback", sum("evaluation.matchbackPaidTrap")),
    "kpi-naive-paid": kpi("Paid by a naive bot", sum("evaluation.naivePaidTrap")),
    "kpi-mb-money": kpi("Matchback loss", sum("evaluation.matchbackWronglyRefunded")),
    "kpi-naive-money": kpi("Naive bot loss", sum("evaluation.naiveWronglyRefunded")),
    "traps-by-kind": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "evaluation.kind" }], valueKey: [sum("evaluation.naivePaidTrap"), sum("evaluation.matchbackPaidTrap")] },
      format: { ...title("Traps paid, by what the listing really was", "75 claims from real product pages, on frozen data; no money moved"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "mb-decisions": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "evaluation.matchback" }], valueKey: [countd("evaluation.id")] },
      format: title("What Matchback decided"),
    },
    cases: {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "evaluation.id" }, { id: "evaluation.claim" }, { id: "evaluation.why" }, { id: "evaluation.store" }, sum("evaluation.paid"), sum("evaluation.offer"),
          { id: "evaluation.aiVerdict" }, { id: "evaluation.matchback" }, { id: "evaluation.naive" }, { id: "evaluation.set" },
        ],
      },
      format: title("Every case"),
    },
  },
  widgetLayout: {
    "kpi-traps": at(0, 0, 4, 7),
    "kpi-mb-paid": at(4, 0, 5, 7),
    "kpi-naive-paid": at(9, 0, 5, 7),
    "kpi-mb-money": at(14, 0, 5, 7),
    "kpi-naive-money": at(19, 0, 5, 7),
    "traps-by-kind": at(0, 7, 16, 18),
    "mb-decisions": at(16, 7, 8, 18),
    cases: at(0, 25, 24, 26),
  },
};

const review: AgPageState = {
  id: "review",
  widgets: {
    queue: custom({
      type: "matchback-review-queue",
      dataMapping: {
        claim: [{ id: "claims.id" }], status: [{ id: "claims.status" }], product: [{ id: "claims.product" }], store: [{ id: "claims.store" }],
        paid: [sum("claims.paid")], offer: [sum("claims.offerPrice")], reason: [{ id: "claims.reason" }], orderRefunded: [{ id: "claims.orderRefunded" }],
      },
      format: title("Waiting for a person", "Approve sends the refund through PayPal; refuse tells the shopper why"),
    }),
    "review-trail": custom({
      type: "matchback-decision-trail",
      dataMapping: { check: [{ id: "checks.check" }], outcome: [{ id: "checks.outcome" }], count: [countd("checks.id")] },
      format: title("What the checks found", "Across every claim"),
    }),
  },
  widgetLayout: {
    queue: at(0, 0, 16, 30),
    "review-trail": at(16, 0, 8, 30),
  },
};

export const PAGE_TITLES: Record<string, string> = { overview: "Overview", review: "Review queue", claims: "Claims", stores: "Stores & products", evaluation: "Evaluation" };

// Bump when the starting report changes, so browsers drop a saved copy of the old one.
export const REPORT_VERSION = 8;

export const consoleReport: AgReportState = {
  selectedPageId: overview.id,
  pages: [overview, review, claims, stores, evaluation],
  panels: { filters: { collapsed: true } },
};
