"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { CookAlongArtifactSchema, type CookAlongArtifact } from "../../lib/schema/artifact";
import {
  EMBED_ARTIFACT_MESSAGE,
  EMBED_CLOSE_MESSAGE,
  EMBED_NEED_ARTIFACT_MESSAGE,
  embeddingOrigin,
  hostOf,
  isMessageOfType,
  isSameOrigin,
  isTrustedMessage,
  samePageCheck,
  type EmbedRequest,
} from "../../lib/embed";
import ArtifactViewer from "../ArtifactViewer";
import ErrorBox from "../ErrorBox";
import ProgressNote from "../ProgressNote";
import {
  apiFetch,
  convertNotices,
  friendlyError,
  type ApiResult,
  type FriendlyError,
} from "../request";
import { withScreenOn } from "../wake-lock";
import styles from "./embed.module.css";

export type EmbedState =
  | { kind: "none" }
  | { kind: "starting"; request: EmbedRequest }
  | { kind: "converting"; url: string }
  | { kind: "loading" }
  | { kind: "mismatch"; recipeHost: string; pageHost: string; url: string }
  | { kind: "error"; error: FriendlyError; url: string | null }
  | { kind: "ready"; artifact: CookAlongArtifact; notices: string[] };

const HANDOFF_TIMEOUT_MS = 8000;

/** First render, identical on server and client. */
export function initialEmbedState(request: EmbedRequest): EmbedState {
  return request.kind === "none" ? { kind: "none" } : { kind: "starting", request };
}

/** The open site's own page for a recipe, opened in a new tab from errors. */
function openSiteHref(url: string | null): string {
  return url ? `/?url=${encodeURIComponent(url)}` : "/";
}

/**
 * Options for friendlyError on a failed /api/convert: the 429 `reason` (C2) and the recipe URL,
 * so the daily-cap message links to /assistants?url=<recipe> (C7). Built as a separate object so
 * it type-checks whether or not request.ts already declares `reason` and `recipeUrl`.
 */
export function convertErrorOptions(
  res: Pick<ApiResult, "timeout" | "data">,
  url: string,
): { timeout: boolean; reason?: string; recipeUrl: string; mayFinish: true } {
  const data = res.data as { reason?: unknown } | null;
  const reason = data && typeof data.reason === "string" ? data.reason : undefined;
  // A URL conversion finishes and caches on the server even if the overlay lets go.
  return reason
    ? { timeout: res.timeout, reason, recipeUrl: url, mayFinish: true }
    : { timeout: res.timeout, recipeUrl: url, mayFinish: true };
}

/** Friendly copy for a failed /api/convert inside the overlay. */
export function convertFailure(res: Pick<ApiResult, "status" | "timeout" | "data">, url: string): FriendlyError {
  const data = res.data as { error?: unknown } | null;
  const message = data && typeof data.error === "string" ? data.error : "";
  return friendlyError(res.status, message, convertErrorOptions(res, url));
}

/**
 * A successful /api/convert body as the ready state. Its warnings (page text
 * cut, timings relabeled, review notes) show as Notes on this conversion,
 * the same as on the home page. Null when the artifact is not valid.
 */
export function readyFromConvert(data: unknown): Extract<EmbedState, { kind: "ready" }> | null {
  const body = data as { artifact?: unknown; warnings?: unknown } | null;
  const valid = CookAlongArtifactSchema.safeParse(body?.artifact);
  if (!valid.success) return null;
  return { kind: "ready", artifact: valid.data, notices: convertNotices(body?.warnings) };
}

/** The error offers its own way forward (the daily cap's "Continue in your AI assistant"). */
function offersAssistants(error: FriendlyError): boolean {
  const action: string | undefined = error.action;
  return action === "assistants";
}

/** Everything except the finished recipe. Exported for render tests. */
export function EmbedStatus({
  state,
  onClose,
}: {
  state: Exclude<EmbedState, { kind: "ready" }>;
  onClose?: () => void;
}) {
  const closeButton = onClose ? (
    <button type="button" className="btn" onClick={onClose}>
      Close
    </button>
  ) : null;

  switch (state.kind) {
    case "none":
      return (
        <section className={styles.status} aria-live="polite">
          <h1 className={styles.title}>No recipe to show</h1>
          <p>
            This Cook Along button wasn&apos;t given a recipe. Site owners: see the embed
            instructions for <code>data-recipe-url</code> and <code>data-src</code>.
          </p>
          <div className="btn-row">{closeButton}</div>
        </section>
      );
    case "starting":
    case "loading":
      return (
        <section className={styles.status} aria-live="polite">
          <h1 className={styles.title}>Getting your Cook Along ready…</h1>
          <p className="meta">Loading the recipe.</p>
        </section>
      );
    case "converting": {
      const host = hostOf(state.url);
      return (
        <section className={styles.status} aria-live="polite">
          <h1 className={styles.title}>Turning this recipe into a Cook Along…</h1>
          <p>
            Reading the recipe{host ? ` from ${host}` : ""}, planning a timeline with mise en place
            first, then checking it against the original. You stay on this page the whole time.
          </p>
          <ProgressNote kind="convert" />
        </section>
      );
    }
    case "mismatch":
      return (
        <section className={styles.status} role="alert">
          <h1 className={styles.title}>This button only converts recipes from this site</h1>
          <p>
            The recipe address is on <strong>{state.recipeHost}</strong>, but this page is on{" "}
            <strong>{state.pageHost}</strong>, so TextSous won&apos;t convert it here.
          </p>
          <p className="meta">
            Site owners: point <code>data-recipe-url</code> at a recipe on your own site.
          </p>
          <div className="btn-row">
            <a className={`btn ${styles.linkButton}`} href={openSiteHref(state.url)} target="_blank" rel="noopener">
              Open it on TextSous Open
            </a>
            {closeButton}
          </div>
        </section>
      );
    case "error":
      return (
        <section className={styles.status}>
          <ErrorBox error={state.error} />
          <div className="btn-row">
            {/* The open site is capped too: don't offer it next to the daily-cap way forward. */}
            {offersAssistants(state.error) ? null : (
              <a className={`btn ${styles.linkButton}`} href={openSiteHref(state.url)} target="_blank" rel="noopener">
                Try on TextSous Open
              </a>
            )}
            {closeButton}
          </div>
        </section>
      );
  }
}

function parentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return embeddingOrigin({
    ancestorOrigins: window.location.ancestorOrigins ?? null,
    referrer: document.referrer,
  });
}

function inFrame(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

/** Ask the host page (embed.js) for a data-src artifact it can fetch itself. */
function requestFromParent(src: string, origin: string | null): Promise<unknown | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, HANDOFF_TIMEOUT_MS, null);
    function done(value: unknown | null) {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(value);
    }
    function onMessage(event: MessageEvent) {
      if (!isTrustedMessage(event, { origin, source: window.parent })) return;
      if (!isMessageOfType(event.data, EMBED_ARTIFACT_MESSAGE) || event.data.src !== src) return;
      done(event.data.artifact ?? null);
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: EMBED_NEED_ARTIFACT_MESSAGE, src }, origin ?? "*");
  });
}

const EXPIRED: FriendlyError = {
  title: "That link has expired",
  detail: "Saved recipes are kept for 24 hours. Convert the recipe again to get a fresh link.",
};

const INVALID_ARTIFACT: FriendlyError = {
  title: "That link didn't work",
  detail: "It did not return a valid Cook Along artifact.",
};

export default function EmbedApp({ request }: { request: EmbedRequest }) {
  const [state, setState] = useState<EmbedState>(() => initialEmbedState(request));
  const [framed, setFramed] = useState(false);
  const started = useRef(false);

  const close = useCallback(() => {
    if (!inFrame()) return;
    // The message carries no data, so "*" is safe when the parent origin is unknown.
    window.parent.postMessage({ type: EMBED_CLOSE_MESSAGE }, parentOrigin() ?? "*");
  }, []);

  const convert = useCallback(async (url: string) => {
    setState({ kind: "converting", url });
    const res = await withScreenOn(() =>
      apiFetch("/api/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      }),
    );
    const data = res.data as { artifact?: unknown; error?: string } | null;
    if (!res.ok || !data || !data.artifact) {
      setState({ kind: "error", error: convertFailure(res, url), url });
      return;
    }
    const ready = readyFromConvert(data);
    if (!ready) {
      setState({
        kind: "error",
        error: friendlyError(res.status, "The server returned an invalid artifact. Try again."),
        url,
      });
      return;
    }
    setState(ready);
  }, []);

  const load = useCallback(async (src: string) => {
    setState({ kind: "loading" });
    let data: unknown = null;
    if (!isSameOrigin(src, window.location.href) && inFrame()) {
      data = await requestFromParent(src, parentOrigin());
    }
    if (data === null) {
      const res = await apiFetch(src);
      if (res.status === 404) {
        setState({ kind: "error", error: EXPIRED, url: null });
        return;
      }
      if (!res.ok || res.data === null) {
        setState({
          kind: "error",
          error: friendlyError(res.status, "", { timeout: res.timeout }),
          url: null,
        });
        return;
      }
      data = res.data;
    }
    const valid = CookAlongArtifactSchema.safeParse(data);
    if (!valid.success) {
      setState({ kind: "error", error: INVALID_ARTIFACT, url: null });
      return;
    }
    setState({ kind: "ready", artifact: valid.data, notices: [] });
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const id = setTimeout(() => {
      setFramed(inFrame());
      if (request.kind === "src") {
        void load(request.src);
        return;
      }
      if (request.kind !== "url") return;
      const check = samePageCheck(request.url, parentOrigin());
      if (check.ok) void convert(request.url);
      else if (check.reason === "mismatch") {
        setState({ kind: "mismatch", recipeHost: check.recipeHost, pageHost: check.pageHost, url: request.url });
      } else {
        setState({
          kind: "error",
          error: {
            title: "That address won't work",
            detail: "The recipe address isn't a valid web page address.",
          },
          url: null,
        });
      }
    }, 0);
    return () => clearTimeout(id);
  }, [request, convert, load]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // Links inside the overlay open a new tab: navigating the iframe would strand the reader.
  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (anchor instanceof HTMLAnchorElement && !anchor.target) {
      anchor.target = "_blank";
      anchor.rel = "noopener";
    }
  }

  const onClose = framed ? close : undefined;

  return (
    <div className={`ts-embed-root ${styles.root}`} onClickCapture={onClickCapture}>
      <main className={styles.main}>
        {state.kind === "ready" ? (
          <ArtifactViewer
            artifact={state.artifact}
            notices={state.notices}
            embedded
            onClose={onClose}
            onStartOver={() => {
              window.location.href = window.location.origin;
            }}
          />
        ) : (
          <EmbedStatus state={state} onClose={onClose} />
        )}
      </main>
      <p className={styles.footer}>
        Converted recipes are private to you: never listed, indexed or shared.{" "}
        <a href="/" target="_blank" rel="noopener">
          TextSous Open
        </a>
      </p>
    </div>
  );
}
