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
    "outcomes-by-day": at(0, 7, 16, 16),
    outcomes: at(16, 7, 8, 16),
    "kept-vs-refunded": at(0, 23, 16, 18),
    "claimed-with": at(16, 23, 8, 18),
    "claim-date": at(0, 41, 8, 6),
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
    "ai-verdicts": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "claims.aiRelation" }], valueKey: [countd("claims.id")] },
      format: title("AI identity verdicts", "When the listing was not the catalogue product"),
    },
  },
  widgetLayout: {
    outcome: at(0, 0, 24, 5),
    "claims-grid": at(0, 5, 24, 22),
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
      dataMapping: { categoryKey: [{ id: "stores.storeType" }], valueKey: [countd("claims.id")] },
      format: title("Store types", "Unknown shops go to a person; resale marketplaces are refused"),
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
  },
};

export const PAGE_TITLES: Record<string, string> = { overview: "Overview", claims: "Claims", stores: "Stores & products" };

// Bump when the starting report changes, so browsers drop a saved copy of the old one.
export const REPORT_VERSION = 2;

export const consoleReport: AgReportState = {
  selectedPageId: overview.id,
  pages: [overview, claims, stores],
  panels: { filters: { collapsed: true } },
};
