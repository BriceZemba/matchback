import type { ReactNode } from "react";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { requestPrefs } from "@/lib/locale-server";
import { LanguageSwitch, ThemeToggle } from "./header-controls";
import { SiteNav } from "./site-nav";
import { judgeMode } from "@/lib/judge";
import { merchantKey } from "@/lib/merchant";
import "./globals.css";

const serif = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"], style: ["normal", "italic"] });
const sans = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-plex-sans", weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-plex-mono", weight: ["400", "500", "700"] });

const description = "A price-match guarantee run by an AI agent: it checks the cheaper offer with Channel3, fixed rules decide, and PayPal refunds the difference. A partial refund instead of a return.";

export const metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL || "https://matchback-tau.vercel.app"),
  title: "Matchback · price match, verified",
  description,
  openGraph: { title: "Matchback: a partial refund instead of a return", description, type: "website" },
  twitter: { card: "summary_large_image", title: "Matchback: a partial refund instead of a return", description },
};

function TagMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M30 4 L58 4 Q60 4 60 6 L60 34 L32 62 Q30 64 28 62 L2 36 Q0 34 2 32 L30 4 Z" fill="#ffd23f" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <circle cx="47" cy="17" r="5" fill="currentColor" />
      <path d="M18 36 l7 7 l14 -16" fill="none" stroke="#161513" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, t, theme } = await requestPrefs();
  const links = [
    { href: "/", label: t.nav.shop },
    { href: "/orders", label: t.nav.orders },
    ...(merchantKey() ? [{ href: "/merchant", label: t.nav.desk }] : []),
    { href: "/how-to-use", label: t.nav.howToUse },
    { href: "/how-it-works", label: t.nav.howItWorks },
    ...(judgeMode() ? [{ href: "/judges", label: t.nav.judges }] : []),
  ];
  return (
    <html lang={t.htmlLang} className={`${serif.variable} ${sans.variable} ${mono.variable}`} {...(theme ? { "data-theme": theme } : {})}>
      <body>
        <header className="site-header">
          <div className="shell">
            <a href="/" className="brand">
              <span className="brand-mark"><TagMark /></span>
              Matchback
            </a>
            <div className="header-tools">
              <span className="pill" title={t.sandboxTitle}>
                <span className="dot" /> {t.sandbox}
              </span>
              <LanguageSwitch current={locale} label={t.language} />
              <ThemeToggle initial={theme} labels={{ toDark: t.toDark, toLight: t.toLight }} />
            </div>
          </div>
          <SiteNav links={links} label={t.nav.label} menuLabel={t.nav.menu} />
        </header>
        {children}
        <footer className="site-footer">
          <div className="shell">
            <span>{t.footerLeft}</span>
            <span>{t.footerRight}</span>
            <span className="footer-links">
              {links.slice(1).map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
