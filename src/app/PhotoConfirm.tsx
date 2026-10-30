"use client";

import type { PhotoTranscription } from "../lib/intake/photo";
import type { CanonicalRecipe } from "../lib/schema/canonical";
import ErrorBox from "./ErrorBox";
import type { FriendlyError } from "./request";

export default function PhotoConfirm({
  photoUrl,
  fileName,
  recipe,
  transcription,
  busy,
  error,
  onConfirm,
  onRetake,
}: {
  photoUrl: string;
  fileName: string;
  recipe: CanonicalRecipe;
  transcription: PhotoTranscription;
  busy: boolean;
  error: FriendlyError | null;
  onConfirm: () => void;
  onRetake: () => void;
}) {
  const credit = [transcription.book, transcription.author].filter(Boolean).join(" by ");
  return (
    <section aria-label="Confirm the transcription">
      <h2>Check the transcription</h2>
      <p className="meta">
        Compare the photo with what was read. Nothing is converted until you confirm.
      </p>
      <figure style={{ margin: "1rem 0" }}>
        {/* next/image cannot optimize blob object URLs, so a plain img is correct here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt={`Uploaded recipe photo (${fileName})`} className="photo-preview" />
      </figure>
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
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
          {busy ? "Converting…" : "Looks right — convert it"}
        </button>
        <button type="button" className="btn" onClick={onRetake} disabled={busy}>
          Use a different photo
        </button>
      </div>
    </section>
  );
}
