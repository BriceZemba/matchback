import { describe, expect, it } from "vitest";
import type { LlmProvider } from "@/lib/llm";
import { amountsIn, explainDecision, rejectExplanation, templateExplanation, type ExplainInput } from "@/lib/verifier/explain";

const approved: ExplainInput = {
  decision: {
    status: "approved",
    refundCents: 4498,
    competitorCents: 23001,
    checks: [{ id: "cheaper", label: "Lower price", outcome: "pass", detail: "$230.01 there vs $274.99 paid (difference $44.98)." }],
  },
  identity: { relation: "same_product", method: "channel3_id", evidence: [] },
  purchasedTitle: "Samsung T7 Portable SSD 1TB",
  paidCents: 27499,
  competitor: { title: "Samsung T7 Portable SSD 1TB", domain: "bhphotovideo.com", condition: "new", availability: "InStock" },
};
const refused: ExplainInput = {
  ...approved,
  decision: {
    status: "refused",
    refundCents: 0,
    competitorCents: 24999,
    checks: [{ id: "identity", label: "Same product", outcome: "fail", detail: "Signature Edition: 32 GB and wireless charging, not the 16 GB model." }],
  },
  purchasedTitle: "Amazon Kindle Paperwhite",
  paidCents: 21999,
  competitor: { title: "Kindle Paperwhite Signature Edition", domain: "target.com", condition: "new" },
};

const provider: LlmProvider = { name: "groq", baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };
const llm = (text: string): typeof fetch => async () =>
  new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "write_explanation", arguments: JSON.stringify({ text }) } }] } }] }), { status: 200 });

describe("rejectExplanation", () => {
  it("rejects an amount that is not in the data", () => {
    expect(rejectExplanation("You paid $274.99 and we refunded $50.00 to your PayPal account.", approved)).toMatch(/not in the data/);
  });
  it("requires the refund amount on an approved claim", () => {
    expect(rejectExplanation("Good news, the other store is cheaper so we are refunding you the difference.", approved)).toMatch(/refund amount/);
  });
  it("rejects a refund promise on a refused claim", () => {
    expect(rejectExplanation("This listing is a different model, but your refund is on its way.", refused)).toMatch(/promises a refund/);
  });
  it("accepts a faithful explanation", () => {
    expect(rejectExplanation("B&H sells the same SSD new for $230.01, so the $44.98 difference is being refunded to your PayPal account.", approved)).toBeNull();
  });
});

describe("explainDecision", () => {
  it("uses the AI text when it passes the guard", async () => {
    const text = "That Target link is the Signature Edition, with 32 GB and wireless charging, not the 16 GB Paperwhite you bought, so it doesn't qualify.";
    const out = await explainDecision(refused, { providers: [provider], fetch: llm(text) });
    expect(out).toEqual({ text, source: "ai", provider: "groq" });
  });
  it("falls back to the template when the AI invents an amount", async () => {
    const out = await explainDecision(approved, { providers: [provider], fetch: llm("We refunded $99.00 to your PayPal account.") });
    expect(out.source).toBe("template");
    expect(out.text).toBe(templateExplanation(approved));
    expect(out.text).toContain("$44.98");
  });
  it("falls back to the template when no AI provider answers", async () => {
    const down: typeof fetch = async () => { throw new TypeError("fetch failed"); };
    const out = await explainDecision(refused, { providers: [provider], fetch: down });
    expect(out.source).toBe("template");
    expect(out.text).toContain("doesn't qualify");
  });
});

describe("explanations in the shopper's language", () => {
  const fr: ExplainInput = { ...approved, locale: "fr" };
  it("reads French and Spanish amount formats", () => {
    expect(amountsIn("La différence de 44,98 $ vous est remboursée ; payé 274,99 $.")).toEqual([4498, 27499]);
    expect(amountsIn("Pagaste US$ 1.234,50 y 44.98 USD")).toEqual([123450, 4498]);
  });
  it("accepts a faithful French text and rejects an invented amount or euros", () => {
    expect(rejectExplanation("B&H vend le même SSD neuf à 230,01 $ : la différence de 44,98 $ vous est remboursée sur PayPal.", fr)).toBeNull();
    expect(rejectExplanation("La différence de 50,00 $ vous est remboursée sur votre compte PayPal.", fr)).toMatch(/not in the data/);
    expect(rejectExplanation("La différence de 44,98 € vous est remboursée sur votre compte PayPal.", fr)).toMatch(/currency/);
  });
  it("rejects a refund promise on a refused claim in French and Spanish", () => {
    expect(rejectExplanation("C'est l'édition Signature, mais votre remboursement est en route.", { ...refused, locale: "fr" })).toMatch(/promises a refund/);
    expect(rejectExplanation("Es la edición Signature, pero tu reembolso ya está en camino.", { ...refused, locale: "es" })).toMatch(/promises a refund/);
  });
  it("falls back to a template in the shopper's language", async () => {
    const out = await explainDecision(fr, { providers: [provider], fetch: llm("Nous avons remboursé 99,00 $.") });
    expect(out.source).toBe("template");
    expect(out.text).toContain("$44.98");
    expect(out.text).toMatch(/remboursée sur votre compte PayPal/);
    expect(templateExplanation({ ...refused, locale: "es" })).toBe("Esta oferta no da derecho a la igualación de precio. Motivo: Mismo producto.");
  });
});
