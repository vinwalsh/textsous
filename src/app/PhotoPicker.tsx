"use client";

import { useState, type ChangeEvent, type ClipboardEvent, type FormEvent } from "react";
import ErrorBox from "./ErrorBox";
import ProgressNote from "./ProgressNote";
import {
  addPagesLabel,
  firstPastedFile,
  MAX_PHOTO_PAGES,
  pageLabel,
  PHOTO_HELP,
  PHOTO_MIME_TYPES,
  transcribeLabel,
} from "./photo-pages";
import { submitButtonClass, type FriendlyError } from "./request";
import type { PhotoPages } from "./use-photo-pages";

/**
 * The Photo tab: up to 3 photos of one recipe, shown in page order as
 * thumbnails with a remove button each. Picking again or pasting adds pages
 * until there are 3.
 */
export default function PhotoPicker({
  photos,
  busy,
  transcribing,
  error,
  onError,
  onSubmit,
  onPasteText,
}: {
  photos: PhotoPages;
  /** Any request running: the list is locked. */
  busy: boolean;
  /** The transcribe request (shrink + upload + read) is running. */
  transcribing: boolean;
  error: FriendlyError | null;
  onError: (error: FriendlyError | null) => void;
  onSubmit: (event: FormEvent) => void;
  onPasteText: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const { pages } = photos;
  const full = pages.length >= MAX_PHOTO_PAGES;

  function addFiles(files: readonly File[]): void {
    const result = photos.add(files);
    setNote(result.note);
    onError(result.problem);
  }

  function onPick(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    // Reset so picking the same photo again still counts as a change.
    event.target.value = "";
    if (files.length > 0) addFiles(files);
  }

  function onPaste(event: ClipboardEvent<HTMLFormElement>): void {
    if (busy) return;
    const items = event.clipboardData ? Array.from(event.clipboardData.items) : [];
    const file = firstPastedFile(items);
    if (file) addFiles([file]);
  }

  function onRemove(id: string): void {
    photos.remove(id);
    setNote(null);
  }

  return (
    <form onSubmit={onSubmit} onPaste={onPaste}>
      <div className="field">
        <span id="photo-pages-label">Photos of the recipe</span>
        <p className="meta photo-help">{PHOTO_HELP}</p>
        {pages.length > 0 ? (
          <ol className="photo-pages" aria-labelledby="photo-pages-label">
            {pages.map((page, i) => (
              <li key={page.id} className="photo-page">
                {/* next/image cannot optimize blob object URLs, so a plain img is correct here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={page.url} alt="" className="photo-thumb" />
                <span className="photo-page-text">
                  <strong>{pageLabel(i)}</strong>
                  <span className="meta">{Math.max(1, Math.round(page.file.size / 1024))} KB</span>
                </span>
                <button
                  type="button"
                  className="btn photo-remove"
                  aria-label={`Remove page ${i + 1}`}
                  onClick={() => onRemove(page.id)}
                  disabled={busy}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        ) : null}
        {full ? null : (
          <label className={busy ? "btn photo-add is-disabled" : "btn photo-add"}>
            <input
              type="file"
              multiple
              accept={PHOTO_MIME_TYPES.join(",")}
              className="visually-hidden"
              disabled={busy}
              onChange={onPick}
            />
            {addPagesLabel(pages.length)}
          </label>
        )}
      </div>
      {note ? (
        <p className="meta" role="status">
          {note}
        </p>
      ) : null}
      <p className="meta">
        Take photos or upload them: PNG, JPEG or WebP. They are shrunk on your device before upload
        and read in memory only.
      </p>
      <p className="meta">Tip: you can also paste a screenshot straight from your clipboard.</p>
      {error ? <ErrorBox error={error} onAction={onPasteText} /> : null}
      <div className="btn-row">
        <button
          type="submit"
          className={submitButtonClass(error)}
          disabled={pages.length === 0 || busy}
        >
          {transcribeLabel(pages.length, transcribing)}
        </button>
      </div>
      {transcribing ? <ProgressNote kind="transcribe" /> : null}
    </form>
  );
}
