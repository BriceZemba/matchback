import { getDb } from "@/lib/db";
import { createChannel3Client } from "@/lib/channel3";
import { cachedChannel3, cacheModeFromEnv } from "@/lib/channel3-cache";

// The demo store's catalog, pinned to fixed Channel3 product ids (search results changed between runs
// in the 2026-10-28 spike, so claims are never matched by searching). Prices are the store's own.
const SEED = [
  { product_id: "e2dXeQi", title: "Samsung T7 Portable SSD 1TB (Titan Gray)", price_cents: 27499 },
  { product_id: "nLZKmNT", title: "Logitech MX Master 3S Performance Wireless Mouse", price_cents: 11999 },
  { product_id: "cTyUOkU", title: "Amazon Kindle Paperwhite", price_cents: 19999 },
  { product_id: "muLXXMd", title: "KitchenAid Artisan Series 5-Quart Tilt-Head Stand Mixer", price_cents: 44999 },
  // Added 2026-10-29: each has several retailers on its Channel3 record (checked that day), so the store
  // shows verified claims, price-watch drops and traps (resale sites, used or out-of-stock offers).
  { product_id: "dgVgimm", title: "Garmin Forerunner 265 GPS Running Smartwatch", price_cents: 44999 },
  { product_id: "m7BdhGq", title: "GoPro HERO12 Black Action Camera", price_cents: 34999 },
  { product_id: "CBwmyTM", title: "Bose QuietComfort Ultra Wireless Noise Cancelling Earbuds", price_cents: 29900 },
  { product_id: "puD6dGn", title: "Vitamix Explorian Series E310 Blender", price_cents: 37995 },
  { product_id: "12pv9iN", title: "Sonos Era 100 Smart Speaker", price_cents: 22900 },
  { product_id: "F5Smbri", title: "Fitbit Charge 6 Fitness & Health Tracker", price_cents: 16995 },
  { product_id: "dSyfEh6", title: "Instant Pot Duo Plus V4 Pressure Cooker", price_cents: 15499 },
  { product_id: "D9iEwzZ", title: "JBL Flip 6 Portable Bluetooth Speaker", price_cents: 13999 },
];

/** Photos chosen by hand, over Channel3's main image: the Fitbit's is cropped, the other two are in a scene. */
const CHOSEN_PHOTOS: Record<string, { url: string; alt: string }> = {
  F5Smbri: { url: "https://cdn.trychannel3.com/03c4fe4a-05f3-4869-8d64-b2840336c2dd?aid=01M6EQQ3C9E4C10TYVYHVJ83A6&mid=p1PB", alt: "Coral Fitbit Charge 6 band with its display, shown from above." },
  puD6dGn: { url: "https://cdn.trychannel3.com/cleaned/v1/521a66d5-9c6e-47e9-b2a8-8e2351eae1e4?aid=01M6ER59CQ7NTVWX5YJYZ7HF7E&mid=VEoQ", alt: "Black Vitamix Explorian blender, on its own." },
  "12pv9iN": { url: "https://cdn.trychannel3.com/cleaned/v1/3418c660-7635-458f-8edf-d7da4804a768?aid=01M6EQQ3XC351RX2YWG1MMJRKK&mid=T9Fg", alt: "White Sonos Era 100 speaker, viewed from the front." },
};

function withChosenPhoto(item: CatalogItem): CatalogItem {
  const photo = CHOSEN_PHOTOS[item.product_id];
  return photo ? { ...item, image_url: photo.url, image_alt: photo.alt } : item;
}

export type CatalogItem = { product_id: string; title: string; price_cents: number; currency: string; image_url: string | null; image_alt: string | null };

/** Product photos come from Channel3 (background-removed version when it has one), fetched once. */
async function fillImages(items: CatalogItem[]) {
  const missing = items.filter((p) => !p.image_url);
  if (missing.length === 0 || !process.env.CHANNEL3_API_KEY) return;
  const db = getDb();
  const channel3 = cachedChannel3(createChannel3Client({ timeoutMs: 8_000 }), db, { mode: cacheModeFromEnv(), ttlMs: 7 * 86_400_000 });
  await Promise.all(
    missing.map(async (p) => {
      try {
        const product = (await channel3.product(p.product_id)) as { images?: { url: string; cleaned_url?: string | null; alt_text?: string; is_main_image?: boolean }[] };
        const img = product.images?.find((i) => i.is_main_image) ?? product.images?.[0];
        if (!img) return;
        p.image_url = img.cleaned_url ?? img.url;
        p.image_alt = img.alt_text ?? p.title;
        await db.run("UPDATE catalog SET image_url = ?, image_alt = ? WHERE product_id = ?", p.image_url, p.image_alt, p.product_id);
      } catch {
        // no photo is fine; the card shows a placeholder
      }
    }),
  );
}

let seeded: Promise<void> | undefined;

/** Insert the pinned products once per server instance (one statement; existing rows are kept). */
export function ensureCatalog(): Promise<void> {
  seeded ??= getDb()
    .run(
      `INSERT INTO catalog (product_id, title, price_cents, currency) VALUES ${SEED.map(() => "(?, ?, ?, 'USD')").join(", ")} ON CONFLICT (product_id) DO NOTHING`,
      ...SEED.flatMap((p) => [p.product_id, p.title, p.price_cents]),
    )
    .then(() => undefined, (err) => { seeded = undefined; throw err; });
  return seeded;
}

export async function listCatalog(): Promise<CatalogItem[]> {
  const db = getDb();
  await ensureCatalog();
  const items = await db.all("SELECT product_id, title, price_cents, currency, image_url, image_alt FROM catalog ORDER BY price_cents") as CatalogItem[];
  await fillImages(items);
  return items.map(withChosenPhoto);
}

export async function getCatalogItem(productId: string): Promise<CatalogItem | undefined> {
  const item = await getDb().get("SELECT product_id, title, price_cents, currency, image_url, image_alt FROM catalog WHERE product_id = ?", productId) as CatalogItem | undefined;
  return item && withChosenPhoto(item);
}
