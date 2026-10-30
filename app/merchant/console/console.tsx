"use client";

// The console: a page bar (pages, view/edit, reset) around one AG Studio instance. Studio owns the
// report being edited; the page bar drives it through AgStudioApi. Edits are kept in this browser.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AgStudioAiModule, type AgReportState, type AgStudioApi, type AgStudioMode } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import type { ConsoleData } from "@/lib/console-data";
import { buildAi } from "./studio/ai";
import { buildStudioData } from "./studio/data";
import { consoleReport, PAGE_TITLES, REPORT_VERSION } from "./studio/initial-report";
import { matchbackStudioTheme } from "./studio/theme";
import { DATA_CHANGED, DATA_RELOADED, matchbackWidgets } from "./studio/widgets";

const STORAGE_KEY = `matchback-console-v${REPORT_VERSION}`;

function savedReport(): AgReportState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AgReportState) : null;
  } catch {
    return null;
  }
}

function save(state: AgReportState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // private window or storage blocked: edits last for this visit only
  }
}

export function Console({ data, licenseKey, aiModels }: { data: ConsoleData; licenseKey?: string; aiModels?: { id: string; label: string }[] }) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const [initialState] = useState<AgReportState>(() => savedReport() ?? consoleReport);
  const [state, setState] = useState<AgReportState>(initialState);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const studioData = useMemo(() => buildStudioData(data), [data]);
  // Read once, when Studio is created.
  const [ai] = useState(() => (aiModels?.length ? buildAi(aiModels) : undefined));
  const router = useRouter();
  // A widget that changed data (the review queue) asks for fresh rows from the server...
  useEffect(() => {
    const changed = () => router.refresh();
    window.addEventListener(DATA_CHANGED, changed);
    return () => window.removeEventListener(DATA_CHANGED, changed);
  }, [router]);
  // ...and once they are in Studio, widgets are told to query again.
  const firstData = useRef(data.asOf);
  useEffect(() => {
    if (data.asOf === firstData.current) return;
    const t = setTimeout(() => window.dispatchEvent(new Event(DATA_RELOADED)), 50);
    return () => clearTimeout(t);
  }, [data.asOf]);

  const select = (pageId: string) => {
    const api = apiRef.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: pageId });
  };
  const reset = () => {
    const api = apiRef.current;
    if (!api) return;
    api.setState(consoleReport);
    api.clearHistory();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  return (
    <section className="console">
      <div className="console-bar">
        <div className="console-pages" role="tablist" aria-label="Console pages">
          {state.pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={state.selectedPageId === p.id}
              className={state.selectedPageId === p.id ? "active" : ""}
              onClick={() => select(p.id)}
            >
              {PAGE_TITLES[p.id] ?? `Page ${i + 1}`}
            </button>
          ))}
        </div>
        <div className="console-actions">
          <span className="subtle console-asof">Data as of {new Date(data.asOf).toLocaleString()}</span>
          {/* Studio shows its AI panel in edit mode, next to the compose and data panels. */}
          {ai && mode === "view" && (
            <button type="button" className="btn btn-accent btn-sm" onClick={() => setMode("edit")}>Ask AI</button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode(mode === "view" ? "edit" : "view")}>
            {mode === "view" ? "Edit layout" : "Done"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Reset</button>
          <a className="btn btn-ghost btn-sm" href="/merchant">Store desk</a>
        </div>
      </div>
      <div className="console-studio">
        <AgStudioProvider licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            theme={matchbackStudioTheme}
            layout={{ widgetBorderEnabled: true }}
            data={studioData}
            widgets={matchbackWidgets}
            ai={ai}
            initialState={initialState}
            mode={mode}
            onApiReady={(e) => { apiRef.current = e.api; }}
            onStudioReady={(e) => setState(e.api.getState())}
            onStateUpdated={(e) => { setState(e.state); save(e.state); }}
          />
        </AgStudioProvider>
      </div>
    </section>
  );
}
