"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export type NavLink = { href: string; label: string };

/**
 * The main menu. A row of links on wide screens; on a phone, one "Menu" button showing the current page
 * that opens the full list, so no link is hidden off-screen.
 */
export function SiteNav({ links, label, menuLabel }: { links: NavLink[]; label: string; menuLabel: string }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const isCurrent = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const current = links.find((l) => isCurrent(l.href));

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <nav className={`site-nav${open ? " open" : ""}`} aria-label={label}>
      <div className="shell">
        <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="site-nav-links" onClick={() => setOpen((o) => !o)}>
          <span className="nav-burger" aria-hidden="true"><i /><i /><i /></span>
          <span>{menuLabel}</span>
          {current && <span className="nav-current">· {current.label}</span>}
          <span className="nav-caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>
        <ul id="site-nav-links">
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} aria-current={isCurrent(l.href) ? "page" : undefined}>{l.label}</a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
