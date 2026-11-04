"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CookAlongArtifactSchema, type CookAlongArtifact } from "../lib/schema/artifact";
import type { CanonicalRecipe } from "../lib/schema/canonical";
import type { PhotoTranscription } from "../lib/intake/photo";
import type { AdjustChoices } from "./AdjustPanel";
import ArtifactViewer from "./ArtifactViewer";
import type { ConvertBody } from "./conversion";
import ErrorBox from "./ErrorBox";
import PhotoConfirm from "./PhotoConfirm";
import PhotoPicker from "./PhotoPicker";
import ProgressiveView from "./ProgressiveView";
import ProgressNote from "./ProgressNote";
import {
  apiFetch,
  convertNotices,
  friendlyError,
  submitButtonClass,
  type FriendlyError,
} from "./request";
import { preparePhotoPages } from "./photo-resize";
import { usePhotoPages, type PhotoPage } from "./use-photo-pages";
import { useConversion } from "./useConversion";
import { withScreenOn } from "./wake-lock";

// Photo-tab helpers live in photo-pages.ts; re-exported for existing importers.
export { firstPastedFile, PHOTO_MIME_TYPES, type PastedItem } from "./photo-pages";

type Tab = "url" | "text" | "photo";

// Shared with the /embed overlay; re-exported for existing importers.
export { convertNotices };

interface PhotoOk {
  recipe: CanonicalRecipe;
  transcription: PhotoTranscription;
  status: string;
  warnings?: unknown;
}

/**
 * Whether the error box offers "Paste the recipe text instead": not on the
 * Pasted text tab, where it would only clear the error and its Details. Pure.
 */
export function offersPasteText(tab: Tab): boolean {
  return tab !== "text";
}

export default function ConverterForm({
  initialUrl,
  initialSrc,
  initialTab = "url",
}: {
  initialUrl: string;
  initialSrc: string;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [urlValue, setUrlValue] = useState(initialUrl);
  const [textValue, setTextValue] = useState("");
  const photos = usePhotoPages();
  const [busy, setBusy] = useState<"convert" | "transcribe" | "load" | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [artifact, setArtifact] = useState<CookAlongArtifact | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{
    photoUrl: string;
    fileName: string;
    /** Every page in order; its object URLs live as long as this screen. */
    pages: PhotoPage[];
    recipe: CanonicalRecipe;
    transcription: PhotoTranscription;
    notices: string[];
  } | null>(null);
  const autoRan = useRef(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // The conversion streams in part by part (useConversion keeps the screen on).
  const conversion = useConversion();
  const { start: startConversion, reset: resetConversion } = conversion;
  // Adjustments chosen before the cook along is ready, applied when it is.
  const [queued, setQueued] = useState<AdjustChoices | null>(null);

  const convert = useCallback(
    async (body: ConvertBody) => {
      setBusy("convert");
      setError(null);
      setQueued(null);
      // The page fills in from the top as each part arrives.
      window.scrollTo(0, 0);
      const final = await startConversion(body);
      setBusy(null);
      if (!final) return;
      if (final.status !== "done") {
        setError(final.error ?? friendlyError(null, ""));
        return;
      }
      if (confirm) URL.revokeObjectURL(confirm.photoUrl);
      setConfirm(null);
    },
    [confirm, startConversion],
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
    setNotices([]);
    setArtifact(valid.data);
    setBusy(null);
    window.scrollTo(0, 0);
  }, []);

  // The confirm screen owns its pages' object URLs: revoke them when it goes.
  useEffect(() => {
    const urls = confirm?.pages.map((page) => page.url) ?? [];
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [confirm]);

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
    const pages = photos.pages;
    if (pages.length === 0 || busy) return;
    setBusy("transcribe");
    setError(null);
    // Shrink on the device first: phone photos exceed the upload limit.
    const prepared = await preparePhotoPages(pages.map((page) => page.file));
    if (!prepared.ok) {
      setError(
        pages.length > 1
          ? {
              title: "Those photos are too big together",
              detail: "Even after shrinking they are over 4 MB. Try fewer photos, or screenshots of the pages.",
            }
          : {
              title: "That photo is too big",
              detail: "Even after shrinking it is over 4 MB. Try a smaller image or a screenshot.",
            },
      );
      setBusy(null);
      return;
    }
    // One request, every page in order: one recipe, one transcription.
    const form = new FormData();
    for (const file of prepared.files) form.append("photo", file);
    const res = await withScreenOn(() => apiFetch("/api/photo", { method: "POST", body: form }));
    const data = res.data as (PhotoOk & { error?: string; reason?: string }) | null;
    if (!res.ok || !data || !data.recipe) {
      setError(friendlyError(res.status, data?.error ?? "", { timeout: res.timeout, reason: data?.reason }));
      setBusy(null);
      return;
    }
    // The pages move to the confirm screen, which revokes their URLs.
    const taken = photos.take();
    setConfirm({
      photoUrl: taken[0]?.url ?? "",
      fileName: taken[0]?.file.name ?? "",
      pages: taken,
      recipe: data.recipe,
      transcription: data.transcription,
      notices: convertNotices(data.warnings),
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
    // Several pages come back to the list so one can be swapped; a single
    // photo is cleared for a different one.
    const kept = confirm && confirm.pages.length > 1 ? confirm.pages.map((page) => page.file) : [];
    setConfirm(null);
    photos.clear();
    if (kept.length > 0) photos.add(kept);
    setTab("photo");
    setError(null);
  }

  function startOver() {
    setArtifact(null);
    setNotices([]);
    setError(null);
    setQueued(null);
    resetConversion();
  }

  if (artifact) {
    return <ArtifactViewer artifact={artifact} onStartOver={startOver} notices={notices} />;
  }

  const run = conversion.state;
  if (run.status === "done" && run.artifact) {
    return (
      <ArtifactViewer
        artifact={run.artifact}
        onStartOver={startOver}
        notices={run.notices}
        overview={run.overview}
        queuedAdjustments={queued}
        built
      />
    );
  }

  if (run.status === "working") {
    return <ProgressiveView state={run} queued={queued} onQueue={setQueued} />;
  }

  if (confirm) {
    return (
      <PhotoConfirm
        photoUrl={confirm.photoUrl}
        fileName={confirm.fileName}
        pages={confirm.pages.map((page) => ({ url: page.url, name: page.file.name }))}
        notices={confirm.notices}
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
    <>
      <section aria-label="Convert a recipe" className="card converter">
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
          <PhotoPicker
            photos={photos}
            busy={busy !== null}
            transcribing={busy === "transcribe"}
            error={error}
            onError={setError}
            onSubmit={onTranscribe}
            onPasteText={switchToPaste}
          />
        ) : (
          <form onSubmit={onConvert}>
            {tab === "url" ? (
              <label className="field">
                <span>Link to the recipe page</span>
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
            {error ? (
              <ErrorBox error={error} onAction={offersPasteText(tab) ? switchToPaste : undefined} />
            ) : null}
            <div className="btn-row">
              <button
                type="submit"
                className={submitButtonClass(error)}
                disabled={busy !== null}
              >
                {busy === "convert" ? "Converting…" : "Convert"}
              </button>
            </div>
            {busy === "convert" ? <ProgressNote kind="convert" /> : null}
          </form>
        )}
        {busy === "load" ? <p className="meta">Loading the saved recipe…</p> : null}
      </section>
      <p className="converter-more">
        No recipe handy? <a href="/demo">Try a demo recipe</a>.
      </p>
    </>
  );
}
