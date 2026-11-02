// AG Studio's data sources for the merchant console: one table per row type in lib/console-data.ts,
// the relations between them, a shared calendar and the measures the store cares about.

import type { AgDataSourcesDefinition, AgExpressionFieldDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from "ag-studio";
import type { ConsoleData } from "@/lib/console-data";
import evalTable from "@/lib/eval-table.json";

const CALENDAR_ID = "calendar";

// [id, name, format, hide?]
type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({
    id, name, format, ...(hide && { hide }),
    // All money is USD.
    ...(format === "currencyFormat" && { formatOptions: { format: "$#,##0.00" } }),
  }));

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split(".");
  const [targetTable, targetField] = target.split(".");
  return { id, source: { tableId: sourceTable!, fieldId: sourceField! }, target: { tableId: targetTable!, fieldId: targetField! }, type: "many-to-one" };
};
const onCalendar = (tableId: string, fieldId: string): AgRelationDefinition => ({ id: `${tableId}-${fieldId}-calendar`, source: { tableId, fieldId }, target: { calendarId: CALENDAR_ID } });

const sumOf = (id: string) => ({ id, aggregation: "sum" as const });
const ratio = (id: string, name: string, description: string, numerator: string, denominator: string): AgExpressionFieldDefinition => ({
  id, name, description, format: "percentageFormat", isMeasure: true,
  expression: { operator: "divide", inputs: [sumOf(numerator), sumOf(denominator)] },
});

export function buildStudioData(data: ConsoleData): AgDataSourcesDefinition {
  const dates = [...data.claims.map((c) => c.day), ...data.orders.map((o) => o.paidAt ?? ""), ...data.refunds.map((r) => r.day)].filter(Boolean).sort();
  const today = data.asOf.slice(0, 10);
  return {
    description:
      "A store's price-match guarantee run by Matchback. Shoppers who paid with PayPal send a cheaper offer (a link, a screenshot, or one the price watch found). " +
      "Matchback checks seven rules (claim window, known store, sold new, in stock, lower price, plausible price, same product) and either refunds the difference through PayPal, refuses, or sends the claim to a person. " +
      "Money is in USD. Sales kept = paid on refunded orders minus the refunds: what a full return would have undone.",
    sources: [
      {
        id: "claims",
        description: "One row per price-match claim. Outcome is Refunded, Refused, With a person (waiting for the store) or in progress. Gap = price paid minus the competitor's price.",
        data: data.claims,
        fields: fields([
          ["id", "Claim ID", "textFormat", true],
          ["createdAt", "Filed at", "dateTimeFormat"],
          ["day", "Claim date", "dateFormat"],
          ["status", "Status code", "textFormat", true],
          ["outcome", "Outcome", "textFormat"],
          ["source", "Claimed with", "textFormat"],
          ["decidedBy", "Decided by", "textFormat"],
          ["orderId", "Order ID", "textFormat", true],
          ["productId", "Product ID", "textFormat", true],
          ["product", "Product", "textFormat"],
          ["store", "Competitor store", "textFormat"],
          ["paid", "Price paid", "currencyFormat"],
          ["offerPrice", "Competitor price", "currencyFormat"],
          ["gap", "Price gap", "currencyFormat"],
          ["refunded", "Refunded", "currencyFormat"],
          ["reason", "Reason", "textFormat"],
          ["aiRelation", "AI identity verdict", "textFormat"],
          ["decisionSeconds", "Seconds to decide", "decimalFormat"],
          ["reviewNote", "Reviewer note", "textFormat"],
          ["isRefunded", "Refunded claims", "integerFormat"],
          ["isRefused", "Refused claims", "integerFormat"],
          ["isReview", "Claims with a person", "integerFormat"],
          ["isDecided", "Decided claims", "integerFormat", true],
          ["isAutomatic", "Decided automatically", "integerFormat", true],
          ["orderRefunded", "Order already refunded", "textFormat", true],
        ]),
      },
      {
        id: "checks",
        description: "One row per check run on a claim (seven per claim, plus screenshot checks). Outcome is Passed, Failed or Needs a person.",
        data: data.checks,
        fields: fields([
          ["id", "Check ID", "textFormat", true],
          ["claimId", "Claim ID", "textFormat", true],
          ["check", "Check", "textFormat"],
          ["outcome", "Check outcome", "textFormat"],
          ["detail", "Check detail", "textFormat"],
          ["isFail", "Failed checks", "integerFormat"],
          ["isReview", "Checks needing a person", "integerFormat"],
        ]),
      },
      {
        id: "orders",
        description: "Paid orders. Claimed sale = paid on orders that received a price-match refund; kept sale = claimed sale minus the refund; full return = what a return would have refunded instead.",
        data: data.orders,
        fields: fields([
          ["id", "Order ID", "textFormat", true],
          ["productId", "Product ID", "textFormat", true],
          ["status", "Order status", "textFormat"],
          ["paidAt", "Paid on", "dateFormat"],
          ["paid", "Order value", "currencyFormat"],
          ["refunded", "Order refunded", "currencyFormat"],
          ["claimedSale", "Claimed sales", "currencyFormat"],
          ["keptSale", "Sales kept", "currencyFormat"],
          ["fullReturn", "Full-return cost", "currencyFormat"],
          ["returnAvoided", "Returns avoided", "integerFormat"],
          ["returnCostAvoided", "Return costs avoided (estimate)", "currencyFormat"],
          ["claims", "Claims on order", "integerFormat"],
        ]),
      },
      {
        id: "products",
        description: "The store's catalogue.",
        data: data.products,
        fields: fields([
          ["id", "Product ID", "textFormat", true],
          ["product", "Catalogue product", "textFormat"],
          ["brand", "Brand", "textFormat"],
          ["price", "List price", "currencyFormat"],
        ]),
      },
      {
        id: "stores",
        description: "Every store the rules know, plus any seen in a claim, with its number of claims. Types: listed competitor, added by the store, brand store, not on the list (sent to a person), resale marketplace (refused).",
        data: data.stores,
        fields: fields([
          ["id", "Store", "textFormat"],
          ["storeType", "Store type", "textFormat"],
          ["claims", "Claims", "integerFormat"],
        ]),
      },
      {
        id: "refunds",
        description: "Price-match refunds sent through PayPal on the original payment.",
        data: data.refunds,
        fields: fields([
          ["claimId", "Refund claim ID", "textFormat", true],
          ["orderId", "Refund order ID", "textFormat", true],
          ["amount", "Refund amount", "currencyFormat"],
          ["refundId", "PayPal refund ID", "textFormat"],
          ["status", "Refund status", "textFormat"],
          ["day", "Refund date", "dateFormat"],
        ]),
      },
      {
        id: "findings",
        description: "Cheaper offers the price watch found and verified after a purchase, before anyone claimed them.",
        data: data.findings,
        fields: fields([
          ["id", "Finding ID", "textFormat", true],
          ["orderId", "Finding order ID", "textFormat", true],
          ["store", "Found at", "textFormat"],
          ["price", "Found price", "currencyFormat"],
          ["refund", "Refund offered", "currencyFormat"],
          ["status", "Finding status", "textFormat"],
          ["day", "Found on", "dateFormat"],
        ]),
      },
      {
        id: "evaluation",
        description: "The evaluation set, not live claims: 75 claims built from real product pages, 52 of them traps, decided by Matchback and by a naive approve-if-cheaper bot on frozen Channel3 answers. No money moved. Keep separate from the live tables.",
        data: evalTable,
        fields: fields([
          ["id", "Case", "textFormat"],
          ["set", "Evaluation set", "textFormat"],
          ["product", "Product bought", "textFormat"],
          ["kind", "Listing is", "textFormat"],
          ["claim", "Claim type", "textFormat"],
          ["why", "What the listing is", "textFormat"],
          ["store", "Listing store", "textFormat"],
          ["paid", "Paid", "currencyFormat"],
          ["offer", "Listing price", "currencyFormat"],
          ["aiVerdict", "AI verdict", "textFormat"],
          ["matchback", "Matchback decided", "textFormat"],
          ["naive", "Naive bot decided", "textFormat"],
          ["isTrap", "Traps tested", "integerFormat"],
          ["matchbackPaidTrap", "Traps paid by Matchback", "integerFormat"],
          ["naivePaidTrap", "Traps paid by the naive bot", "integerFormat"],
          ["matchbackWronglyRefunded", "Wrongly refunded by Matchback", "currencyFormat"],
          ["naiveWronglyRefunded", "Wrongly refunded by the naive bot", "currencyFormat"],
        ]),
      },
    ],
    relationships: [
      manyToOne("claim-order", "claims.orderId", "orders.id"),
      manyToOne("claim-store", "claims.store", "stores.id"),
      manyToOne("order-product", "orders.productId", "products.id"),
      manyToOne("check-claim", "checks.claimId", "claims.id"),
      manyToOne("refund-claim", "refunds.claimId", "claims.id"),
      manyToOne("finding-order", "findings.orderId", "orders.id"),
      onCalendar("claims", "day"),
      onCalendar("orders", "paidAt"),
      onCalendar("refunds", "day"),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: "Calendar",
        range: { from: { type: "date", value: dates[0] ?? today }, to: { type: "date", value: dates.at(-1) ?? today } },
        fragments: ["year", "quarter", "month", "week", "day", "dayOfWeek"],
      },
    ],
    expressions: [
      ratio("automaticShare", "Decided automatically", "Share of decided claims that Matchback settled with no person.", "claims.isAutomatic", "claims.isDecided"),
      ratio("refusalRate", "Refusal rate", "Share of decided claims that were refused.", "claims.isRefused", "claims.isDecided"),
      ratio("keptShare", "Share of sale kept", "Sales kept / claimed sales: how much of each claimed sale the store kept.", "orders.keptSale", "orders.claimedSale"),
    ],
  };
}
