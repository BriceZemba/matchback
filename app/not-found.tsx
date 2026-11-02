import { requestPrefs } from "@/lib/locale-server";

export const metadata = { title: "Matchback · not found" };

export default async function NotFound() {
  const { t } = await requestPrefs();
  return (
    <main className="shell">
      <div className="page-head">
        <h1>{t.errors.notFoundTitle}</h1>
        <p className="muted">{t.errors.notFoundBody}</p>
        <div><a className="btn btn-primary" href="/">{t.errors.backToShop}</a></div>
      </div>
    </main>
  );
}
