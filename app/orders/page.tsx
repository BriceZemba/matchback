import { cookies } from "next/headers";
import { listCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { requestPrefs } from "@/lib/locale-server";
import { fromCents } from "@/lib/money";
import { MY_ORDERS_COOKIE, parseMyOrders } from "@/lib/my-orders";

export const dynamic = "force-dynamic";
export const metadata = { title: "Matchback · my orders" };

type Row = { id: string; product_id: string; amount_cents: number | string; captured_cents: number | string | null; status: string; created_at: string; claims: number | string; refunded: number | string | null };

// The orders placed from this browser (cookie), newest first.
export default async function MyOrders() {
  const { t, locale } = await requestPrefs();
  const m = t.myOrders;
  const ids = parseMyOrders((await cookies()).get(MY_ORDERS_COOKIE)?.value);
  const rows: Row[] = [];
  for (const id of ids) {
    const row = (await getDb().get(
      `SELECT o.id, o.product_id, o.amount_cents, o.captured_cents, o.status, o.created_at,
              (SELECT COUNT(*) FROM claims c WHERE c.order_id = o.id) AS claims,
              (SELECT SUM(r.amount_cents) FROM refunds r WHERE r.order_id = o.id AND r.status = 'completed') AS refunded
       FROM orders o WHERE o.id = ?`, id,
    )) as Row | undefined;
    if (row) rows.push(row);
  }
  const catalog = rows.length ? await listCatalog() : [];
  const item = (id: string) => catalog.find((c) => c.product_id === id);
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });

  return (
    <main className="shell">
      <div className="page-head">
        <p className="eyebrow">{m.eyebrow}</p>
        <h1 className="rise">{m.title}</h1>
        <p className="muted" style={{ maxWidth: 640 }}>{m.lede}</p>
      </div>
      {rows.length === 0 ? (
        <div className="card card-pad">
          <p className="muted" style={{ marginTop: 0 }}>{m.empty}</p>
          <a className="btn btn-primary" href="/">{m.shop}</a>
        </div>
      ) : (
        <ul className="order-list">
          {rows.map((r, i) => {
            const product = item(r.product_id);
            const paid = r.status === "captured";
            const refunded = Number(r.refunded ?? 0);
            return (
              <li key={r.id} className="card order-row rise" style={{ ["--i" as string]: i }}>
                <div className="receipt-thumb">
                  {product?.image_url ? <img src={product.image_url} alt="" loading="lazy" /> : null}
                </div>
                <div className="order-row-body">
                  <strong>{product?.title ?? r.product_id}</strong>
                  <span className="subtle">
                    {when(r.created_at)} · ${fromCents(Number(r.captured_cents ?? r.amount_cents))} · {m.claims(Number(r.claims))}
                  </span>
                  <span className="order-row-tags">
                    <span className={`status ${paid ? "status-ok" : "status-wait"}`}>{paid ? m.paid : m.unpaid}</span>
                    {refunded > 0 && <span className="status status-ok">{m.refunded(`$${fromCents(refunded)}`)}</span>}
                  </span>
                </div>
                <a className="btn btn-ghost btn-sm" href={`/orders/${r.id}`}>{m.open}</a>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
