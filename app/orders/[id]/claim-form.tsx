"use client";

import { useRef, useState } from "react";
import { SubmitButton } from "../../submit-button";
import type { Dict } from "@/lib/i18n";
import type { SampleLink } from "@/lib/judge";

/** Two ways to claim: paste the competitor's link, or upload a screenshot / photo of the offer. */
export function ClaimForm({ orderId, t, samples = [] }: { orderId: string; t: Dict["form"]; samples?: SampleLink[] }) {
  const [mode, setMode] = useState<"link" | "image">("link");
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const link = useRef<HTMLInputElement>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setFileName(file.name);
  };

  return (
    <div>
      <div className="tabs" role="tablist" aria-label={t.how}>
        <button type="button" role="tab" aria-selected={mode === "link"} className={mode === "link" ? "tab active" : "tab"} onClick={() => setMode("link")}>{t.tabLink}</button>
        <button type="button" role="tab" aria-selected={mode === "image"} className={mode === "image" ? "tab active" : "tab"} onClick={() => setMode("image")}>
          {t.tabImage} <span className="ai-chip" style={{ marginLeft: 6 }}>AI</span>
        </button>
      </div>

      {mode === "link" ? (
        <form action="/api/claims" method="post" key="link" className="tab-panel">
          <input type="hidden" name="orderId" value={orderId} />
          <div className="field">
            <label htmlFor="competitorUrl">{t.linkLabel}</label>
            <input ref={link} className="input" id="competitorUrl" name="competitorUrl" type="url" required placeholder="https://www.bestbuy.com/site/…" />
            {samples.length > 0 && (
              <div className="samples" aria-label="Sample links">
                <span className="subtle mono">Judges: try a real link</span>
                {samples.map((s) => (
                  <button key={s.url} type="button" className={`sample ${s.expect}`} title={s.why} onClick={() => { if (link.current) link.current.value = s.url; }}>
                    {s.label} <span>{s.expect === "refund" ? "→ refund" : "→ refused"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="form-row">
            <SubmitButton pendingLabel={t.starting} className="btn btn-accent">{t.submit}</SubmitButton>
          </div>
        </form>
      ) : (
        <form action="/api/claims/image" method="post" encType="multipart/form-data" key="image" className="tab-panel">
          <input type="hidden" name="orderId" value={orderId} />
          <label
            className={`drop${drag ? " drag" : ""}${preview ? " has-file" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const file = e.dataTransfer.files[0];
              if (file && input.current) {
                const dt = new DataTransfer();
                dt.items.add(file);
                input.current.files = dt.files;
                pick(file);
              }
            }}
          >
            <input ref={input} type="file" name="image" accept="image/png,image/jpeg,image/webp" required className="visually-hidden" onChange={(e) => pick(e.target.files?.[0])} />
            {preview ? (
              <>
                <img src={preview} alt={t.yourShot} />
                <span className="subtle">{fileName} · {t.change}</span>
              </>
            ) : (
              <>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 16l4-4 3 3 5-5 4 4M4 6h16v12H4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                <strong>{t.drop}</strong>
                <span className="subtle">{t.dropHint}</span>
              </>
            )}
          </label>
          <div className="form-row">
            <SubmitButton pendingLabel={t.uploading} className="btn btn-accent">{t.submit}</SubmitButton>
          </div>
          <p className="subtle" style={{ margin: "10px 0 0" }}>{t.imageNote}</p>
        </form>
      )}
    </div>
  );
}
