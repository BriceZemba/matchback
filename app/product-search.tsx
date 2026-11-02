"use client";

import { useRef, useState, type ReactNode } from "react";
import { matchesSearch } from "@/lib/product-search";

/**
 * The store's shelf with its search box. Filters as you type and keeps the search in the address bar.
 * Without JavaScript the box submits as ?q=, which the server renders with the same filter.
 * Cards are hidden, not removed, so a pending checkout keeps its state. A card coming back from hidden
 * would replay its staggered entrance, so typing turns that animation off.
 */
export function ProductSearch({ title, items, initialQuery, counts, labels }: {
  title: string;
  items: { id: string; text: string; card: ReactNode }[];
  initialQuery: string;
  /** The count line for each possible number of results, indexed by that number. */
  counts: string[];
  labels: { search: string; placeholder: string; clear: string; none: string; showAll: string; products: string };
}) {
  const [query, setQuery] = useState(initialQuery);
  const [typed, setTyped] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const shown = items.filter((p) => matchesSearch(p.text, query));

  function update(next: string) {
    setQuery(next);
    setTyped(true);
    const url = new URL(window.location.href);
    if (next.trim()) url.searchParams.set("q", next);
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  }

  function clear() {
    update("");
    input.current?.focus();
  }

  return (
    <>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="subtle mono" role="status">{counts[shown.length]}</span>
      </div>
      <form
        className="shop-search"
        role="search"
        action="/"
        method="get"
        onSubmit={(e) => { e.preventDefault(); input.current?.blur(); }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <input
          ref={input}
          className="input"
          type="search"
          name="q"
          value={query}
          maxLength={80}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={labels.placeholder}
          aria-label={labels.search}
          onChange={(e) => update(e.target.value)}
        />
        {query && (
          <button type="button" className="shop-search-clear" aria-label={labels.clear} onClick={clear}>×</button>
        )}
      </form>
      {shown.length === 0 && (
        <div className="card card-pad shop-search-none">
          <p className="muted">{labels.none}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>{labels.showAll}</button>
        </div>
      )}
      <section className={typed ? "grid shop-typed" : "grid"} aria-label={labels.products}>
        {items.map((p) => (
          <div key={p.id} className="shop-cell" hidden={!shown.includes(p)}>{p.card}</div>
        ))}
      </section>
    </>
  );
}
