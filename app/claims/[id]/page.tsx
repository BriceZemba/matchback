import { notFound } from "next/navigation";
import { getClaim } from "@/lib/verifier/run";
import { ClaimView } from "./claim-view";
import { requestPrefs } from "@/lib/locale-server";

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getClaim(id))) notFound();
  const { locale, t } = await requestPrefs();
  return <ClaimView id={id} locale={locale} t={{ ...t.claim, checkingTitle: t.claim.checkingTitle("{host}") }} />;
}
