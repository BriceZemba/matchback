"use client";

import dynamic from "next/dynamic";
import type { ConsoleData } from "@/lib/console-data";

// AG Studio is large and browser-only: load it on this page alone, after hydration.
const Console = dynamic(() => import("./console").then((m) => m.Console), {
  ssr: false,
  loading: () => <div className="console-loading"><span className="spinner" aria-hidden="true" /> Loading the console…</div>,
});

export function ConsoleLoader(props: { data: ConsoleData; licenseKey?: string; aiModels?: { id: string; label: string }[] }) {
  return <Console {...props} />;
}
