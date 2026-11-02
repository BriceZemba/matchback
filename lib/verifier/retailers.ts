// Which stores a price match is honoured against. Large chains publish such a list ("identical item at a
// local or online competitor": named retailers only), because "any website" invites a claim against a
// shop set up for the purpose. A store not on the list is not refused: the claim goes to a person.
//
// The store's settings add to the list; MATCHBACK_EXTRA_RETAILERS (comma-separated domains) is their default.

const KNOWN_RETAILERS = [
  // general and big-box
  "amazon.com", "walmart.com", "target.com", "costco.com", "samsclub.com", "bjs.com", "kohls.com", "macys.com",
  "nordstrom.com", "jcpenney.com", "qvc.com", "hsn.com", "meijer.com", "kroger.com",
  // electronics and office
  "bestbuy.com", "bhphotovideo.com", "adorama.com", "newegg.com", "microcenter.com", "crutchfield.com", "abt.com",
  "pcrichard.com", "cdw.com", "staples.com", "officedepot.com", "dell.com", "apple.com", "gamestop.com",
  "worldwidestereo.com",
  // home and kitchen
  "homedepot.com", "lowes.com", "williams-sonoma.com", "crateandbarrel.com", "surlatable.com", "wayfair.com",
  "bedbathandbeyond.com", "farmandfleet.com",
  // sports and outdoors
  "dickssportinggoods.com", "academy.com", "rei.com", "backcountry.com", "competitivecyclist.com",
];

export function extraRetailersFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.MATCHBACK_EXTRA_RETAILERS ?? "").split(",").map((d) => d.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean);
}

const letters = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/**
 * The brand's own store counts too (bose.com for a Bose product, kitchenaid.com for KitchenAid). The brand
 * is read from the start of the store's own product title (one or two words: "Instant Pot" → instantpot)
 * and from Channel3's brand field for the purchased product, never from the competitor's listing.
 */
export function brandStore(domain: string, storeTitle: string, brands: string[] = []): boolean {
  const label = letters(domain.replace(/\.[a-z.]+$/, ""));
  if (label.length < 3) return false;
  const words = storeTitle.trim().split(/\s+/);
  const candidates = [words[0] ?? "", words.slice(0, 2).join(""), ...brands].map(letters).filter((w) => w.length >= 3);
  return candidates.includes(label);
}

export function isKnownRetailer(domain: string, storeTitle = "", brands: string[] = [], extra: string[] = extraRetailersFromEnv()): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  const listed = [...KNOWN_RETAILERS, ...extra].some((r) => d === r || d.endsWith(`.${r}`));
  return listed || brandStore(d, storeTitle, brands);
}
