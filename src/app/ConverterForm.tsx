"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CookAlongArtifactSchema, type CookAlongArtifact } from "../lib/schema/artifact";
import type { CanonicalRecipe } from "../lib/schema/canonical";
import type { PhotoTranscription } from "../lib/intake/photo";
import ArtifactViewer from "./ArtifactViewer";
import ErrorBox from "./ErrorBox";
import PhotoConfirm from "./PhotoConfirm";
import { apiFetch, friendlyError, type FriendlyError } from "./request";

type Tab = "url" | "text" | "photo";

interface ConvertOk {
  artifact: CookAlongArtifact;
  cached: boolean;
}

interface PhotoOk {
  recipe: CanonicalRecipe;
  transcription: PhotoTranscription;
  status: string;
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export default function ConverterForm({
  initialUrl,
  initialSrc,
}: {
  initialUrl: string;
  initialSrc: string;
}) {
  const [tab, setTab] = useState<Tab>("url");
  const [urlValue, setUrlValue] = useState(initialUrl);
  const [textValue, setTextValue] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"convert" | "transcribe" | "load" | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [artifact, setArtifact] = useState<CookAlongArtifact | null>(null);
  const [confirm, setConfirm] = useState<{
    photoUrl: string;
    fileName: string;
    recipe: CanonicalRecipe;
    transcription: PhotoTranscription;
  } | null>(null);
  const autoRan = useRef(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const convert = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy("convert");
      setError(null);
      const res = await apiFetch("/api/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = res.data as (ConvertOk & { error?: string }) | null;
      if (!res.ok || !data || !data.artifact) {
        setError(friendlyError(res.status, data?.error ?? "", { timeout: res.timeout }));
        setBusy(null);
        return;
      }
      const valid = CookAlongArtifactSchema.safeParse(data.artifact);
      if (!valid.success) {
        setError(friendlyError(res.status, "The server returned an invalid artifact. Try again."));
        setBusy(null);
        return;
      }
      if (confirm) URL.revokeObjectURL(confirm.photoUrl);
      setConfirm(null);
      setArtifact(valid.data);
      setBusy(null);
      window.scrollTo(0, 0);
    },
    [confirm],
  );

  const loadFromSrc = useCallback(async (src: string) => {
    setBusy("load");
    setError(null);
    const res = await apiFetch(src);
    const data = res.data as unknown;
    if (res.status === 404) {
      setError({
        title: "That link has expired",
        detail: "Saved recipes are kept for 24 hours. Convert the recipe again to get a fresh link.",
      });
      setBusy(null);
      return;
    }
    if (!res.ok || data === null) {
      setError(friendlyError(res.status, "", { timeout: res.timeout }));
      setBusy(null);
      return;
    }
    const valid = CookAlongArtifactSchema.safeParse(data);
    if (!valid.success) {
      setError({
        title: "That link didn't work",
        detail: "It did not return a valid Cook Along artifact.",
      });
      setBusy(null);
      return;
    }
    setArtifact(valid.data);
    setBusy(null);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    const id = setTimeout(() => {
      if (initialSrc) void loadFromSrc(initialSrc);
      else if (initialUrl) void convert({ url: initialUrl });
    }, 0);
    return () => clearTimeout(id);
  }, [initialSrc, initialUrl, convert, loadFromSrc]);

  async function onConvert(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (tab === "url") await convert({ url: urlValue });
    else await convert({ text: textValue });
  }

  async function onTranscribe(event: FormEvent) {
    event.preventDefault();
    if (!photoFile || busy) return;
    if (photoFile.size > MAX_PHOTO_BYTES) {
      setError({
        title: "That photo is too big",
        detail: "Photos must be under 5 MB. Try a smaller image.",
      });
      return;
    }
    setBusy("transcribe");
    setError(null);
    const form = new FormData();
    form.set("photo", photoFile);
    const res = await apiFetch("/api/photo", { method: "POST", body: form });
    const data = res.data as (PhotoOk & { error?: string }) | null;
    if (!res.ok || !data || !data.recipe) {
      setError(friendlyError(res.status, data?.error ?? "", { timeout: res.timeout }));
      setBusy(null);
      return;
    }
    setConfirm({
      photoUrl: URL.createObjectURL(photoFile),
      fileName: photoFile.name,
      recipe: data.recipe,
      transcription: data.transcription,
    });
    setBusy(null);
    window.scrollTo(0, 0);
  }

  function switchToPaste() {
    setTab("text");
    setError(null);
    setTimeout(() => textRef.current?.focus(), 0);
  }

  function retake() {
    if (confirm) URL.revokeObjectURL(confirm.photoUrl);
    setConfirm(null);
    setPhotoFile(null);
    setTab("photo");
    setError(null);
  }

  function startOver() {
    setArtifact(null);
    setError(null);
  }

  if (artifact) {
    return <ArtifactViewer artifact={artifact} onStartOver={startOver} />;
  }

  if (confirm) {
    return (
      <PhotoConfirm
        photoUrl={confirm.photoUrl}
        fileName={confirm.fileName}
        recipe={confirm.recipe}
        transcription={confirm.transcription}
        busy={busy === "convert"}
        error={error}
        onConfirm={() => void convert({ recipe: confirm.recipe })}
        onRetake={retake}
      />
    );
  }

  return (
    <section aria-label="Convert a recipe">
      <div className="tabs" role="tablist" aria-label="Recipe source">
        {(["url", "text", "photo"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className="tab"
            onClick={() => {
              setTab(t);
              setError(null);
            }}
          >
            {t === "url" ? "Recipe URL" : t === "text" ? "Pasted text" : "Photo"}
          </button>
        ))}
      </div>

      {tab === "photo" ? (
        <form onSubmit={onTranscribe}>
          <label className="field">
            <span>Take or upload a photo of the recipe</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              capture="environment"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="meta">PNG, JPEG or WebP, up to 5 MB. The photo is read in memory only.</p>
          {photoFile ? (
            <p className="meta">
              Selected: {photoFile.name} ({Math.round(photoFile.size / 1024)} KB)
            </p>
          ) : null}
          {error ? <ErrorBox error={error} onAction={switchToPaste} /> : null}
          <div className="btn-row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!photoFile || busy !== null}
            >
              {busy === "transcribe" ? "Transcribing…" : "Transcribe photo"}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={onConvert}>
          {tab === "url" ? (
            <label className="field">
              <span>Recipe URL</span>
              <input
                type="url"
                required
                placeholder="https://example.com/recipe"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
              />
            </label>
          ) : (
            <label className="field">
              <span>Recipe text</span>
              <textarea
                ref={textRef}
                required
                placeholder="Paste the ingredients and steps here"
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
              />
            </label>
          )}
          {error ? <ErrorBox error={error} onAction={switchToPaste} /> : null}
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy !== null}>
              {busy === "convert" ? "Converting…" : "Convert"}
            </button>
          </div>
          {busy === "convert" ? (
            <p className="meta">This usually takes about a minute.</p>
          ) : null}
        </form>
      )}
      {busy === "load" ? <p className="meta">Loading the saved recipe…</p> : null}
    </section>
  );
}
