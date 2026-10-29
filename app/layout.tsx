import type { ReactNode } from "react";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", weight: ["600", "700", "800"] });
const body = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata = {
  title: "Matchback",
  description: "Price-match guarantees that check the claim before they pay it.",
};

function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 15l5-5 4 4 7-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h5v5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <header className="site-header">
          <div className="shell">
            <a href="/" className="brand">
              <span className="brand-mark"><Mark /></span>
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
            <span>Competitor offers checked with Channel3 · Payments and refunds by PayPal</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
