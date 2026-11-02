"use client";

import { useRef, useState } from "react";
import { SubmitButton } from "../../submit-button";
import type { Dict } from "@/lib/i18n";
import type { SampleLink } from "@/lib/judge";

// Vercel rejects bodies over 4.5 MB, and a phone photo is often larger. Shrinking here also keeps claims
// fast; the AI reads a price tag just as well at this size.
const MAX_BYTES = 4 * 1024 * 1024;
const SHRINK_ABOVE = 2.5 * 1024 * 1024;
const MAX_SIDE = 2200;

async function shrink(file: File): Promise<File> {
  if (file.size <= SHRINK_ABOVE) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/** Two ways to claim: paste the competitor's link, or upload a screenshot / photo of the offer. */
export function ClaimForm({ orderId, t, samples = [] }: { orderId: string; t: Dict["form"]; samples?: SampleLink[] }) {
  const [mode, setMode] = useState<"link" | "image">("link");
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [tooBig, setTooBig] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const link = useRef<HTMLInputElement>(null);

  const pick = async (picked: File | undefined) => {
    if (!picked || !input.current) return;
    const file = await shrink(picked);
    const dt = new DataTransfer();
    if (file.size <= MAX_BYTES) dt.items.add(file);
    input.current.files = dt.files;
    setTooBig(file.size > MAX_BYTES);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file.size > MAX_BYTES ? null : URL.createObjectURL(file));
    setFileName(file.size > MAX_BYTES ? null : file.name);
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
              void pick(e.dataTransfer.files[0]);
            }}
          >
            <input ref={input} type="file" name="image" accept="image/png,image/jpeg,image/webp" required className="visually-hidden" onChange={(e) => void pick(e.target.files?.[0])} />
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
          {tooBig && <p className="notice notice-warn" role="alert">{t.tooBig}</p>}
          <div className="form-row">
            <SubmitButton pendingLabel={t.uploading} className="btn btn-accent">{t.submit}</SubmitButton>
          </div>
          <p className="subtle" style={{ margin: "10px 0 0" }}>{t.imageNote}</p>
        </form>
      )}
    </div>
  );
}
