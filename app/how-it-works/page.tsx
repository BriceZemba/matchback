import { howItWorks } from "@/lib/guides";
import { requestPrefs } from "@/lib/locale-server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { locale } = await requestPrefs();
  return { title: `Matchback · ${howItWorks(locale).meta}` };
}

// The agent explained: the claim pipeline, the checks, where the AI is, how money is protected, the evidence.
export default async function HowItWorksPage() {
  const { locale } = await requestPrefs();
  const g = howItWorks(locale);
  return (
    <main className="shell guide">
      <div className="page-head">
        <p className="eyebrow">{g.eyebrow}</p>
        <h1 className="rise">{g.title}</h1>
        <p className="muted guide-lede">{g.lede}</p>
      </div>

      <section className="guide-section">
        <h2>{g.flowTitle}</h2>
        <ol className="flow">
          {g.flow.map((f, i) => (
            <li key={f.tag} className="card card-pad rise" style={{ ["--i" as string]: i }}>
              <span className="flow-tag">{f.tag}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-section">
        <h2>{g.checksTitle}</h2>
        <p className="muted">{g.checksLede}</p>
        <div className="card checks-table">
          {g.checks.map((c, i) => (
            <div key={c.name} className="checks-row">
              <span className="mono checks-n">{String(i + 1).padStart(2, "0")}</span>
              <strong>{c.name}</strong>
              <span>{c.rule}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="guide-section">
        <h2>{g.aiTitle}</h2>
        <div className="two-col">
          <div className="card card-pad ai-box">
            <span className="ai-chip">{g.aiDoes}</span>
            <ul className="rule-list plain">{g.aiDoesList.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          <div className="card card-pad ai-box ai-not">
            <span className="ai-chip">{g.aiDoesNot}</span>
            <ul className="rule-list plain">{g.aiDoesNotList.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        </div>
      </section>

      <section className="guide-section">
        <h2>{g.moneyTitle}</h2>
        <ul className="card card-pad rule-list">{g.money.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>

      <section className="guide-section">
        <h2>{g.proofTitle}</h2>
        <div className="stat-row proof-row">
          {g.proof.map((p) => (
            <div key={p.label} className="stat card">
              <strong>{p.figure}</strong>
              <span className="subtle">{p.label}</span>
            </div>
          ))}
        </div>
        <p className="subtle" style={{ marginTop: 12 }}>{g.proofNote}</p>
      </section>

      <section className="guide-section">
        <h2>{g.stackTitle}</h2>
        <dl className="card card-pad stack-list">
          {g.stack.map((s) => (
            <div key={s.name}>
              <dt>{s.name}</dt>
              <dd>{s.role}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="guide-cta">
        <a className="btn btn-accent" href="/">{g.cta}</a>
        <a className="btn btn-ghost" href="/how-to-use">{g.ctaUse} →</a>
      </div>
    </main>
  );
}
