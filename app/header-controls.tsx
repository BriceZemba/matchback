"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LOCALES, type Locale } from "@/lib/i18n";

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

/** Light / dark switch. The choice is saved in a cookie so the server renders it without a flash. */
export function ThemeToggle({ initial, labels }: { initial: "light" | "dark" | null; labels: { toDark: string; toLight: string } }) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(initial);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const effective = theme ?? (systemDark ? "dark" : "light");
  const next = effective === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={next === "dark" ? labels.toDark : labels.toLight}
      title={next === "dark" ? labels.toDark : labels.toLight}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        setCookie("theme", next);
        setTheme(next);
      }}
    >
      {effective === "dark" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
      )}
    </button>
  );
}

const NAMES: Record<Locale, string> = { en: "EN", fr: "FR", es: "ES" };

/** Language switch: saves the choice in a cookie and re-renders the page on the server. */
export function LanguageSwitch({ current, label }: { current: Locale; label: string }) {
  const router = useRouter();
  return (
    <div className="lang" role="group" aria-label={label}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={l === current}
          className={l === current ? "active" : ""}
          lang={l}
          onClick={() => {
            setCookie("lang", l);
            router.refresh();
          }}
        >
          {NAMES[l]}
        </button>
      ))}
    </div>
  );
}
