import { notFound } from "next/navigation";
import { listCatalog } from "@/lib/catalog";
import { judgeMode, SAMPLE_LINKS } from "@/lib/judge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Matchback · guide for judges" };

// A short, practical path through the demo. Only served in judge mode.
export default async function Judges() {
  if (!judgeMode()) notFound();
  const items = await listCatalog();
  const titleOf = (id: string) => items.find((p) => p.product_id === id)?.title ?? id;
  return (
    <main className="shell judges">
      <div className="page-head">
        <a className="back" href="/">← Store</a>
        <h1 className="rise">Try Matchback in five minutes</h1>
        <p className="muted" style={{ maxWidth: 680, fontSize: 17 }}>
          A store&apos;s price-match guarantee, run by an agent: the shopper sends a cheaper offer, Matchback checks it with Channel3 and AI,
          fixed rules decide, and PayPal refunds the difference. Everything runs on the PayPal sandbox: no real money moves.
        </p>
      </div>

      <ol className="judge-steps">
        <li className="card card-pad rise" style={{ ["--i" as string]: 1 }}>
          <span className="n">1</span>
          <div>
            <h2>Buy something</h2>
            <p>Pick any product in the <a href="/">store</a> and pay with PayPal. Log in with the <strong>sandbox buyer account</strong> given in the Devpost testing instructions (or your own PayPal sandbox personal account). You come back to your order page once PayPal approves.</p>
          </div>
        </li>
        <li className="card card-pad rise" style={{ ["--i" as string]: 2 }}>
          <span className="n">2</span>
          <div>
            <h2>Claim with a link</h2>
            <p>On the order page, the claim form shows one-click sample links: real product pages, some that qualify and some traps (another model, a bundle, a refurbished marketplace). Click one, then <em>Check price match</em>. The receipt shows every check, the evidence and a note written by the AI.</p>
            <table className="sample-table">
              <thead><tr><th>Product</th><th>Sample</th><th>Expected</th></tr></thead>
              <tbody>
                {Object.entries(SAMPLE_LINKS).flatMap(([id, links]) =>
                  links.map((s) => (
                    <tr key={s.url}>
                      <td>{titleOf(id)}</td>
                      <td><a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a></td>
                      <td className={s.expect === "refund" ? "ok" : "no"}>{s.expect === "refund" ? "Refund" : "Refused"}: {s.why.toLowerCase()}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
            <p className="subtle">Expected outcomes are from 2026-10-29; live prices and stock can change them. One refund per order: buy again to try another approved claim.</p>
          </div>
        </li>
        <li className="card card-pad rise" style={{ ["--i" as string]: 3 }}>
          <span className="n">3</span>
          <div>
            <h2>Claim with a screenshot</h2>
            <p>Bought the Samsung T7? Use the <em>Upload a screenshot</em> tab with <a href="/sample-bestbuy-t7.jpg" download>this Best Buy screenshot</a>. AI vision reads the product, store and price, Channel3 finds the live listing, and the refund always uses the live price, never the one in the image.</p>
          </div>
        </li>
        <li className="card card-pad rise" style={{ ["--i" as string]: 4 }}>
          <span className="n">4</span>
          <div>
            <h2>Let the price watch find it</h2>
            <p>On a paid order, press <em>Check prices now</em>. Matchback looks at the other stores selling the same product; when one is cheaper and passes the same checks, it appears as a one-click claim. The Garmin, GoPro and Bose usually have one.</p>
          </div>
        </li>
        <li className="card card-pad rise" style={{ ["--i" as string]: 5 }}>
          <span className="n">5</span>
          <div>
            <h2>Be the store</h2>
            <p>Open the <a href="/merchant">store desk</a> with the <strong>merchant key</strong> from the Devpost testing instructions. Claims Matchback could not settle alone wait there with their evidence: approve one with a refund amount (it goes through the same guarded PayPal refund) or refuse it, and the shopper&apos;s receipt updates. The desk also shows every decision, money refunded and sales kept. <strong>Open the console</strong> for the same data in AG Studio: Matchback&apos;s own widgets (money kept, decision trail, a review queue you can approve from) and an assistant that reads the queue, explains a claim and proposes a decision, which only your click confirms.</p>
          </div>
        </li>
        <li className="card card-pad rise" style={{ ["--i" as string]: 6 }}>
          <span className="n">6</span>
          <div>
            <h2>Switch language and theme</h2>
            <p>English, French and Spanish from the header, including the AI&apos;s note on new claims; light and dark mode.</p>
          </div>
        </li>
      </ol>
    </main>
  );
}
