import { ClaimView } from "./claim-view";

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClaimView id={id} />;
}
