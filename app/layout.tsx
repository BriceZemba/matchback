import type { ReactNode } from "react";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const serif = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"], style: ["normal", "italic"] });
const sans = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-plex-sans", weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-plex-mono", weight: ["400", "500", "700"] });

export const metadata = {
  title: "Matchback · price match, verified",
  description: "Found it cheaper? Matchback checks the offer and refunds the difference through PayPal.",
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <header className="site-header">
          <div className="shell">
            <a href="/" className="brand">
              <span className="brand-mark"><TagMark /></span>
              Matchback
            </a>
            <span className="pill" title="PayPal sandbox: no real money moves">
              <span className="dot" /> Sandbox · test money
            </span>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="shell">
            <span>Demo store on the PayPal sandbox. No real money moves.</span>
            <span>Offers checked with Channel3 · Payments and refunds by PayPal</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
