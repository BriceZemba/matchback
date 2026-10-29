import { listCatalog } from "@/lib/catalog";
import { fromCents } from "@/lib/money";
import { SubmitButton } from "./submit-button";

export const dynamic = "force-dynamic";

export default async function Store({ searchParams }: { searchParams: Promise<{ cancelled?: string; error?: string }> }) {
  const params = await searchParams;
  const items = await listCatalog();
  return (
    <main>
      <div className="shell">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow rise" style={{ ["--i" as string]: 0 }}>Price-match guarantee · 14 days</span>
            <h1 className="rise" style={{ ["--i" as string]: 1 }}>
              Seen it cheaper? <em>We pay the difference.</em>
            </h1>
            <p className="rise" style={{ ["--i" as string]: 2 }}>
              Send us the other store&apos;s link or a screenshot. We check it is the same product, sold new and in stock,
              and refund the gap straight to your PayPal account. No forms, no waiting for a reply.
            </p>
            <div className="guarantee rise" style={{ ["--i" as string]: 3 }}>
              <span>Link or screenshot</span>
              <span>Checked in seconds</span>
              <span>Paid back via PayPal</span>
            </div>
          </div>
          <img className="hero-art rise" style={{ ["--i" as string]: 2 }} src="/hero.svg" alt="A price tag showing $274.99 crossed out and $230.01 elsewhere, with a receipt stamped MATCHED: $44.98 back to you." />
        </section>
      </div>

      <p className="ticker" aria-label="Guarantee terms">
        <span>Same model, sold new</span>
        <span>In stock at a real store</span>
        <span>Resale &amp; refurbished excluded</span>
        <span>Refund = the live price gap</span>
      </p>

      <div className="shell">
        {params.cancelled && <p className="notice" role="status">Checkout cancelled. Nothing was charged.</p>}
        {params.error && <p className="notice notice-warn" role="alert">{params.error}</p>}

        <div className="section-head">
          <h2>In the shop</h2>
          <span className="subtle mono">{items.length} items · prices in USD</span>
        </div>
        <section className="grid" aria-label="Products">
          {items.map((p, i) => (
            <article key={p.product_id} className="card product rise" style={{ ["--i" as string]: i + 3 }}>
              <div className="product-media">
                <span className="tag-corner">Price-matched</span>
                {p.image_url ? <img src={p.image_url} alt={p.image_alt ?? p.title} loading="lazy" /> : <span className="subtle">No photo</span>}
              </div>
              <div className="product-body">
                <h3 className="product-title">{p.title}</h3>
                <div className="product-foot">
                  <span className="price">${fromCents(p.price_cents)}</span>
                  <form action="/api/checkout" method="post">
                    <input type="hidden" name="productId" value={p.product_id} />
                    <SubmitButton pendingLabel="Opening PayPal" className="btn btn-primary">Pay with PayPal</SubmitButton>
                  </form>
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
