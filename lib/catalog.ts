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
];

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
        db.prepare("UPDATE catalog SET image_url = ?, image_alt = ? WHERE product_id = ?").run(p.image_url, p.image_alt, p.product_id);
      } catch {
        // no photo is fine; the card shows a placeholder
      }
    }),
  );
}

export async function listCatalog(): Promise<CatalogItem[]> {
  const db = getDb();
  const insert = db.prepare("INSERT OR IGNORE INTO catalog (product_id, title, price_cents, currency) VALUES (?, ?, ?, 'USD')");
  for (const p of SEED) insert.run(p.product_id, p.title, p.price_cents);
  const items = db.prepare("SELECT product_id, title, price_cents, currency, image_url, image_alt FROM catalog ORDER BY price_cents").all() as CatalogItem[];
  await fillImages(items);
  return items;
}

export function getCatalogItem(productId: string): CatalogItem | undefined {
  return getDb().prepare("SELECT product_id, title, price_cents, currency, image_url, image_alt FROM catalog WHERE product_id = ?").get(productId) as CatalogItem | undefined;
}
