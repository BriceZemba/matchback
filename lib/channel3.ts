// Channel3 REST client: the fields Matchback's verifier reads. Shapes observed in the 2026-10-28 spike
// (spikes/channel3/FINDINGS.md): offers carry price, availability, condition (null on resale sites and
// some retailers) and domain; price history returns `history` plus `statistics.current_status`.

export type C3Offer = {
  url?: string;
  domain: string;
  price: { price: number; currency: string; compare_at_price?: number | null };
  availability?: "InStock" | "OutOfStock" | string;
  condition?: "new" | "used" | "refurbished" | string | null;
};

export type C3Product = {
  id: string;
  title: string;
  description?: string;
  brands?: { id?: string; name: string }[];
  category?: string;
  key_features?: string[];
  structured_attributes?: Record<string, string[]>;
  variants?: { selected?: { name: string; label: string }[] } | null;
  offers?: C3Offer[];
};

export type C3PriceStats = {
  mean: number;
  min_price: number;
  max_price: number;
  current_price: number;
  current_status: "low" | "typical" | "high" | string;
};

export class Channel3Error extends Error {
  constructor(readonly status: number | "timeout" | "network", message: string) {
    super(message);
  }
}

export type Channel3Client = {
  lookup(url: string): Promise<C3Product>;
  product(id: string): Promise<C3Product>;
  priceStats(id: string): Promise<C3PriceStats | null>;
  /** Text and/or image search; used when a claim arrives as a screenshot instead of a link. */
  search?(query: { text?: string; base64Image?: string; websiteDomain?: string }, limit?: number): Promise<C3Product[]>;
};

export function createChannel3Client(opts: { apiKey?: string; fetch?: typeof fetch; timeoutMs?: number } = {}): Channel3Client {
  const apiKey = opts.apiKey ?? process.env.CHANNEL3_API_KEY;
  if (!apiKey) throw new Error("CHANNEL3_API_KEY is not configured");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 45_000; // uncached lookups took up to 38 s in the spike

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`https://api.trychannel3.com${path}`, {
        method,
        headers: { "x-api-key": apiKey!, "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new Channel3Error(timedOut ? "timeout" : "network", `${method} ${path} failed: ${timedOut ? "timeout" : String(err)}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        detail = (JSON.parse(text) as { detail?: string }).detail ?? detail;
      } catch {}
      throw new Channel3Error(res.status, detail);
    }
    return JSON.parse(text) as T;
  }

  return {
    async lookup(url) {
      const data = await call<{ product?: C3Product } & Partial<C3Product>>("POST", "/v1/lookup", { url });
      const product = (data.product ?? data) as C3Product;
      if (!product?.id) throw new Channel3Error(502, "lookup returned no product");
      return product;
    },
    product: (id) => call<C3Product>("GET", `/v1/products/${encodeURIComponent(id)}`),
    async search(query, limit = 10) {
      const body: Record<string, unknown> = { limit };
      if (query.text) body.query = query.text;
      if (query.base64Image) body.base64_image = query.base64Image;
      // Channel3 resolves a plain domain in website_ids, so a search can be limited to one store.
      if (query.websiteDomain) body.filters = { website_ids: [query.websiteDomain] };
      const data = await call<{ products?: C3Product[] }>("POST", "/v1/search", body);
      return data.products ?? [];
    },
    async priceStats(id) {
      try {
        const data = await call<{ statistics?: C3PriceStats }>("GET", `/v0/price-tracking/history/${encodeURIComponent(id)}?days=90`);
        return data.statistics ?? null;
      } catch {
        return null; // context only, never a gate
      }
    },
  };
}

/** The retailer domain of a URL, without "www.". */
export function domainOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

/** The offer belonging to the retailer the shopper linked to. */
export function offerForDomain(product: C3Product, domain: string): C3Offer | undefined {
  return product.offers?.find((o) => domain === o.domain || domain.endsWith(`.${o.domain}`) || o.domain.endsWith(`.${domain}`));
}
