import { describe, expect, it } from "vitest";
import { checkDetail, translatedDetail } from "@/lib/verifier/check-text";
import { decide, settingsFromEnv, type PolicyInput } from "@/lib/verifier/policy";

const base = settingsFromEnv({} as NodeJS.ProcessEnv);
const offer = (over: object = {}) => ({ price: { price: 80, currency: "USD" }, availability: "InStock", condition: "new", ...over }) as never;
const identity = (relation: string, method = "ai") => ({ relation, method, provider: "groq", evidence: ["Some English evidence."] }) as never;
const input = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  paidCents: 10000, currency: "USD", capturedAt: "2026-11-01T00:00:00Z", now: new Date("2026-11-02T01:00:00Z"),
  competitorDomain: "bestbuy.com", knownRetailer: true, settings: base, offer: offer(), identity: identity("same_product"), ...over,
});

// Every path through the policy, so a new sentence there fails here until it has its translations.
const DECISIONS: PolicyInput[] = [
  input(),
  input({ capturedAt: "2026-11-02T00:30:00Z" }),
  input({ capturedAt: "2026-10-01T00:00:00Z" }),
  input({ competitorDomain: "ebay.com" }),
  input({ knownRetailer: false, competitorDomain: "unknown-shop.example" }),
  input({ offer: undefined }),
  input({ offer: offer({ condition: "used" }) }),
  input({ offer: offer({ condition: "refurbished" }) }),
  input({ offer: offer({ condition: null }) }),
  input({ conditionSource: "product_record" }),
  input({ offer: offer({ availability: "OutOfStock" }) }),
  input({ offer: offer({ availability: null }) }),
  input({ offer: offer({ price: { price: 80, currency: "EUR" } }) }),
  input({ offer: offer({ price: { price: 30, currency: "USD" } }) }),
  input({ settings: { ...base, autoRefundLimitCents: 500 } }),
  input({ identity: null }),
  input({ identity: identity("same_product", "channel3_id") }),
  ...["same_product_other_color", "different_model", "bundle_or_kit", "accessory_or_part", "used_or_refurbished_listing", "cannot_tell"].map((r) => input({ identity: identity(r) })),
];

describe("check texts", () => {
  it.each(["fr", "es"] as const)("every sentence of the policy has its %s translation", (locale) => {
    for (const d of DECISIONS.map(decide)) {
      for (const c of d.checks) {
        expect(translatedDetail(c.detail, locale), c.detail).not.toBeNull();
        expect(translatedDetail(c.detail, locale)).not.toMatch(/\$\d(?![\d.,])/);
      }
    }
  });

  it("carries the values across", () => {
    expect(checkDetail("$230.01 there vs $274.99 paid (difference $44.98).", "fr")).toBe("$230.01 là-bas, contre $274.99 payés (écart de $44.98).");
    expect(checkDetail("Paid 3 days ago; the window is 14 days.", "es")).toBe("Pagado hace 3 días; el plazo es de 14 días.");
    expect(checkDetail("bjs.com is on this store's list of price-match competitors.", "fr")).toBe("bjs.com figure sur la liste des concurrents de ce magasin.");
  });

  it("leaves the AI's English evidence out of a translated verdict", () => {
    expect(checkDetail("AI comparison (groq): same product. Both listings name the T7.", "fr")).toBe("L'IA confirme qu'il s'agit du même produit.");
  });

  it("keeps a screenshot's own words", () => {
    expect(checkDetail('Your image shows "Samsung External SSD", which does not look like the GoPro HERO12 you bought. A person will check it.', "fr"))
      .toBe("Votre image montre « Samsung External SSD », qui ne ressemble pas au produit acheté (GoPro HERO12). Une personne va vérifier.");
  });

  it("shows English as stored, and an unknown sentence as it was", () => {
    expect(checkDetail("Anything at all.", "en")).toBe("Anything at all.");
    expect(translatedDetail("A sentence from an older claim.", "fr")).toBeNull();
    expect(checkDetail("A sentence from an older claim.", "fr")).toBe("A sentence from an older claim.");
  });
});
