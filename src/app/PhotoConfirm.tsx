"use client";

import type { PhotoTranscription } from "../lib/intake/photo";
import type { CanonicalRecipe } from "../lib/schema/canonical";
import ErrorBox from "./ErrorBox";
import ProgressNote from "./ProgressNote";
import { submitButtonClass, type FriendlyError } from "./request";

export default function PhotoConfirm({
  photoUrl,
  fileName,
  pages,
  notices = [],
  recipe,
  transcription,
  busy,
  error,
  onConfirm,
  onRetake,
}: {
  photoUrl: string;
  fileName: string;
  /** Every page in order when the recipe ran over several photos. */
  pages?: readonly { url: string; name: string }[];
  /** Readable notes on the transcription (another recipe left out). */
  notices?: readonly string[];
  recipe: CanonicalRecipe;
  transcription: PhotoTranscription;
  busy: boolean;
  error: FriendlyError | null;
  onConfirm: () => void;
  onRetake: () => void;
}) {
  const credit = [transcription.book, transcription.author].filter(Boolean).join(" by ");
  const shown = pages && pages.length > 0 ? pages : [{ url: photoUrl, name: fileName }];
  const several = shown.length > 1;
  return (
    <section aria-label="Confirm the transcription">
      <h2>Check the transcription</h2>
      <p className="meta">
        Compare the {several ? "photos" : "photo"} with what was read. Nothing is converted until
        you confirm.
      </p>
      {several ? (
        <ol className="photo-confirm-pages">
          {shown.map((page, i) => (
            <li key={page.url}>
              <figure>
                {/* next/image cannot optimize blob object URLs, so a plain img is correct here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.url}
                  alt={`Page ${i + 1} of the recipe (${page.name})`}
                  className="photo-preview"
                />
                <figcaption className="meta">Page {i + 1}</figcaption>
              </figure>
            </li>
          ))}
        </ol>
      ) : (
        <figure style={{ margin: "1rem 0" }}>
          {/* next/image cannot optimize blob object URLs, so a plain img is correct here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shown[0].url}
            alt={`Uploaded recipe photo (${shown[0].name})`}
            className="photo-preview"
          />
        </figure>
      )}
      {notices.length > 0 ? (
        <div className="notice" role="note">
          {notices.map((notice, i) => (
            <p key={i} style={{ margin: 0 }}>
              {notice}
            </p>
          ))}
        </div>
      ) : null}
      <h3>Transcription</h3>
      <pre className="transcript">{transcription.text}</pre>
      <p className="meta">
        {credit ? `Seen on the page: ${credit}` : "No book or author visible on the page."}
        {transcription.page ? ` · Page ${transcription.page}` : ""}
      </p>
      <div className="card">
        <p>
          <strong>{recipe.title}</strong> · Serves {recipe.nativeServings} ·{" "}
          {recipe.ingredients.length} ingredients · {recipe.steps.length} steps
        </p>
      </div>
      {error ? <ErrorBox error={error} /> : null}
      {busy ? <ProgressNote kind="convert" /> : null}
      <div className="btn-row">
        <button
          type="button"
          className={submitButtonClass(error)}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Converting…" : "Looks right — convert it"}
        </button>
        <button type="button" className="btn" onClick={onRetake} disabled={busy}>
          {several ? "Change the photos" : "Use a different photo"}
        </button>
      </div>
    </section>
  );
}
