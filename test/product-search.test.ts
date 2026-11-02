import { describe, expect, it } from "vitest";
import { matchesSearch, searchTextOf } from "@/lib/product-search";

const CATALOG = [
  { product_id: "nLZKmNT", title: "Logitech MX Master 3S Performance Wireless Mouse" },
  { product_id: "m7BdhGq", title: "GoPro HERO12 Black Action Camera" },
  { product_id: "12pv9iN", title: "Sonos Era 100 Smart Speaker" },
  { product_id: "D9iEwzZ", title: "JBL Flip 6 Portable Bluetooth Speaker" },
  { product_id: "F5Smbri", title: "Fitbit Charge 6 Fitness & Health Tracker" },
  { product_id: "dgVgimm", title: "Garmin Forerunner 265 GPS Running Smartwatch" },
  { product_id: "CBwmyTM", title: "Bose QuietComfort Ultra Wireless Noise Cancelling Earbuds" },
];
const found = (query: string) => CATALOG.filter((p) => matchesSearch(searchTextOf(p), query)).map((p) => p.product_id);

describe("store search", () => {
  it("shows everything for an empty search or punctuation alone", () => {
    expect(found("")).toHaveLength(CATALOG.length);
    expect(found("   ")).toHaveLength(CATALOG.length);
    expect(found(" & ")).toHaveLength(CATALOG.length);
  });

  it("ignores case and accents", () => {
    expect(found("LOGITECH")).toEqual(["nLZKmNT"]);
    expect(found("écouteurs")).toEqual(["CBwmyTM"]);
    expect(found("ecouteurs")).toEqual(["CBwmyTM"]);
  });

  it("needs every word, in any order", () => {
    expect(found("speaker jbl")).toEqual(["D9iEwzZ"]);
    expect(found("jbl mouse")).toEqual([]);
  });

  it("matches the start of a word, not the middle", () => {
    expect(found("era")).toEqual(["12pv9iN"]);
    expect(found("6")).toEqual(["D9iEwzZ", "F5Smbri"]);
    expect(found("logi")).toEqual(["nLZKmNT"]);
  });

  it("finds products by their French and Spanish names", () => {
    expect(found("souris")).toEqual(["nLZKmNT"]);
    expect(found("ratón")).toEqual(["nLZKmNT"]);
    expect(found("enceinte")).toEqual(["12pv9iN", "D9iEwzZ"]);
    expect(found("altavoz")).toEqual(["12pv9iN", "D9iEwzZ"]);
    expect(found("montre")).toEqual(["F5Smbri", "dgVgimm"]);
  });

  it("finds nothing for a product the store does not sell", () => {
    expect(found("playstation")).toEqual([]);
  });
});
