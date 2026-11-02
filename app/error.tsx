"use client";

import { useEffect } from "react";

const TEXT: Record<string, { title: string; body: string; retry: string }> = {
  en: { title: "Something went wrong", body: "No money has moved because of this error. Try again in a moment.", retry: "Try again" },
  fr: { title: "Une erreur est survenue", body: "Cette erreur n'a fait bouger aucun argent. Réessayez dans un instant.", retry: "Réessayer" },
  es: { title: "Algo salió mal", body: "Este error no ha movido dinero. Inténtalo de nuevo en un momento.", retry: "Reintentar" },
};

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  const t = TEXT[typeof document === "undefined" ? "en" : document.documentElement.lang] ?? TEXT.en!;
  return (
    <main className="shell">
      <div className="page-head">
        <h1>{t.title}</h1>
        <p className="muted">{t.body}</p>
        <div><button type="button" className="btn btn-primary" onClick={reset}>{t.retry}</button></div>
      </div>
    </main>
  );
}
