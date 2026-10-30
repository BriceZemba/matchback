"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export type NavLink = { href: string; label: string };

/** The main menu. The current page is marked for screen readers and styled. */
export function SiteNav({ links, label }: { links: NavLink[]; label: string }) {
  const path = usePathname() ?? "/";
  const current = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const list = useRef<HTMLUListElement>(null);
  // On a phone the menu scrolls sideways: keep the current page's link in view.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && list.current) list.current.scrollLeft = Math.max(0, el.offsetLeft - list.current.clientWidth / 2 + el.clientWidth / 2);
  }, [path]);
  return (
    <nav className="site-nav" aria-label={label}>
      <div className="shell">
        <ul ref={list}>
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} aria-current={current(l.href) ? "page" : undefined}>{l.label}</a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
