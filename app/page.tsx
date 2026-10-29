import { listCatalog } from "@/lib/catalog";
import { fromCents } from "@/lib/money";
import { SubmitButton } from "./submit-button";

export const dynamic = "force-dynamic";

function Tick() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function Store({ searchParams }: { searchParams: Promise<{ cancelled?: string; error?: string }> }) {
  const params = await searchParams;
  const items = await listCatalog();
  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
        <span className="eyebrow rise" style={{ ["--i" as string]: 0 }}>Price-match guarantee</span>
        <h1 className="rise" style={{ ["--i" as string]: 1 }}>Found it cheaper? Get the difference back.</h1>
        <p className="muted rise" style={{ ["--i" as string]: 2 }}>
          Paste the other store&apos;s link within 14 days. Matchback checks the offer is the same product, sold new and in
          stock, then refunds the difference straight to your PayPal account.
        </p>
        <div className="guarantee rise" style={{ ["--i" as string]: 3 }}>
          <span><Tick /> Checked in seconds</span>
          <span><Tick /> Refunded through PayPal</span>
          <span><Tick /> No forms, no screenshots</span>
        </div>
        </div>
        <aside className="demo" aria-label="Example of a price-match check">
          <div className="demo-head"><span>Example check</span><span className="status status-ok">Approved</span></div>
          <div className="demo-url">bhphotovideo.com/…/samsung_t7_portable_ssd</div>
          <ul className="demo-steps">
            <li style={{ ["--i" as string]: 0 }}><span className="m">✓</span>Same product: Samsung T7 1TB</li>
            <li style={{ ["--i" as string]: 1 }}><span className="m">✓</span>Sold new, in stock</li>
            <li style={{ ["--i" as string]: 2 }}><span className="m">✓</span>$230.01 vs $274.99 paid</li>
            <li style={{ ["--i" as string]: 3 }}><span className="m">✓</span>Not a bundle, refurb or other model</li>
          </ul>
          <div className="demo-total"><span className="subtle">Refunded to PayPal</span><strong>$44.98</strong></div>
        </aside>
      </section>

      {params.cancelled && <p className="notice notice-info" role="status">Checkout cancelled. Nothing was charged.</p>}
      {params.error && <p className="notice notice-warn" role="alert">{params.error}</p>}

      <section className="grid" aria-label="Products">
        {items.map((p, i) => (
          <article key={p.product_id} className="card product rise" style={{ ["--i" as string]: i + 4 }}>
            <div className="product-media">
              {p.image_url ? <img src={p.image_url} alt={p.image_alt ?? p.title} loading="lazy" /> : <span className="subtle">No photo</span>}
            </div>
            <div className="product-body">
              <h2 className="product-title">{p.title}</h2>
              <div className="product-foot">
                <span className="price">${fromCents(p.price_cents)}</span>
                <form action="/api/checkout" method="post">
                  <input type="hidden" name="productId" value={p.product_id} />
                  <SubmitButton pendingLabel="Opening PayPal">Pay with PayPal</SubmitButton>
                </form>
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
