import { listCatalog } from "@/lib/catalog";
import { fromCents } from "@/lib/money";
import { SubmitButton } from "./submit-button";
import { requestPrefs } from "@/lib/locale-server";
import { judgeMode } from "@/lib/judge";

export const dynamic = "force-dynamic";

export default async function Store({ searchParams }: { searchParams: Promise<{ cancelled?: string; error?: string }> }) {
  const params = await searchParams;
  const items = await listCatalog();
  const { t: { store: t, nav } } = await requestPrefs();
  return (
    <main>
      {judgeMode() && (
        <p className="demo-strip">
          <span>{nav.demoNote}</span>
          <a href="/judges">{nav.judgesCta}</a>
        </p>
      )}
      <div className="shell">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow rise" style={{ ["--i" as string]: 0 }}>{t.eyebrow}</span>
            <h1 className="rise" style={{ ["--i" as string]: 1 }}>
              {t.h1a} <em>{t.h1b}</em>
            </h1>
            <p className="rise" style={{ ["--i" as string]: 2 }}>
              {t.lede}
            </p>
            <div className="guarantee rise" style={{ ["--i" as string]: 3 }}>
              <span>{t.g1}</span>
              <span>{t.g2}</span>
              <span>{t.g3}</span>
            </div>
            <p className="hero-links rise" style={{ ["--i" as string]: 4 }}>
              <a href="/how-to-use">{nav.howToUse} →</a>
              <a href="/how-it-works">{nav.howItWorks} →</a>
            </p>
          </div>
          <img className="hero-art rise" style={{ ["--i" as string]: 2 }} src="/hero.svg" alt={t.heroAlt} />
        </section>
      </div>

      <p className="ticker" aria-label={t.terms}>
        <span>{t.t1}</span>
        <span>{t.t2}</span>
        <span>{t.t3}</span>
        <span>{t.t4}</span>
      </p>

      <div className="shell">
        {params.cancelled && <p className="notice" role="status">{t.cancelled}</p>}
        {params.error && <p className="notice notice-warn" role="alert">{params.error}</p>}

        <div className="section-head">
          <h2>{t.inShop}</h2>
          <span className="subtle mono">{t.count(items.length)}</span>
        </div>
        <section className="grid" aria-label="Products">
          {items.map((p, i) => (
            <article key={p.product_id} className="card product rise" style={{ ["--i" as string]: i + 3 }}>
              <div className="product-media">
                <span className="tag-corner">{t.tag}</span>
                {p.image_url ? <img src={p.image_url} alt={p.image_alt ?? p.title} loading="lazy" /> : <span className="subtle">{t.noPhoto}</span>}
              </div>
              <div className="product-body">
                <h3 className="product-title">{p.title}</h3>
                <div className="product-foot">
                  <span className="price">${fromCents(p.price_cents)}</span>
                  <form action="/api/checkout" method="post">
                    <input type="hidden" name="productId" value={p.product_id} />
                    <SubmitButton pendingLabel={t.opening} className="btn btn-primary">{t.pay}</SubmitButton>
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
