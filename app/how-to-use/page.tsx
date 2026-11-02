import { howToUse, withStoreRules } from "@/lib/guides";
import { loadStoreSettings } from "@/lib/store-settings";
import { requestPrefs } from "@/lib/locale-server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { locale } = await requestPrefs();
  return { title: `Matchback · ${howToUse(locale).meta}` };
}

// Step-by-step use, for shoppers and for the store.
export default async function HowToUsePage() {
  const { locale } = await requestPrefs();
  const g = withStoreRules(howToUse(locale), locale, await loadStoreSettings());
  return (
    <main className="shell guide">
      <div className="page-head">
        <p className="eyebrow">{g.eyebrow}</p>
        <h1 className="rise">{g.title}</h1>
        <p className="muted guide-lede">{g.lede}</p>
      </div>

      <section className="guide-section">
        <h2>{g.shopperTitle}</h2>
        <ol className="guide-steps">
          {g.shopper.map((s, i) => (
            <li key={s.title} className="card card-pad rise" style={{ ["--i" as string]: i }}>
              <span className="n">{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                {s.points && <ul className="guide-points">{s.points.map((p) => <li key={p}>{p}</li>)}</ul>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-section">
        <h2>{g.outcomesTitle}</h2>
        <div className="outcomes">
          {g.outcomes.map((o) => (
            <div key={o.label} className={`card card-pad outcome outcome-${o.tone}`}>
              <span className={`stamp-mini ${o.tone}`}>{o.label}</span>
              <p>{o.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="guide-section">
        <h2>{g.rulesTitle}</h2>
        <ul className="card card-pad rule-list">
          {g.rules.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </section>

      <section className="guide-section">
        <h2>{g.storeTitle}</h2>
        <ol className="guide-steps">
          {g.store.map((s, i) => (
            <li key={s.title} className="card card-pad">
              <span className="n">{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-section">
        <h2>{g.faqTitle}</h2>
        <div className="faq">
          {g.faq.map((f) => (
            <details key={f.q} className="card">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="guide-cta">
        <a className="btn btn-accent" href="/">{g.cta}</a>
        <a className="btn btn-ghost" href="/how-it-works">{g.ctaWorks} →</a>
      </div>
    </main>
  );
}
