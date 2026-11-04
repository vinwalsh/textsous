"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { RecipeOverview } from "../../lib/convert-events";
import { CookAlongArtifactSchema, type CookAlongArtifact } from "../../lib/schema/artifact";
import {
  EMBED_ARTIFACT_MESSAGE,
  EMBED_CLOSE_MESSAGE,
  EMBED_NEED_ARTIFACT_MESSAGE,
  adjustLine,
  embeddingOrigin,
  hostOf,
  isMessageOfType,
  isSameOrigin,
  isTrustedMessage,
  samePageCheck,
  type EmbedAdjust,
  type EmbedRequest,
} from "../../lib/embed";
import { hasAdjustment, type AdjustChoices } from "../AdjustPanel";
import ArtifactViewer from "../ArtifactViewer";
import { initialConversionState, type ConversionState } from "../conversion";
import ErrorBox from "../ErrorBox";
import ProgressiveView from "../ProgressiveView";
import {
  apiFetch,
  convertNotices,
  friendlyError,
  type ApiResult,
  type FriendlyError,
} from "../request";
import { useConversion } from "../useConversion";
import styles from "./embed.module.css";

export type EmbedState =
  | { kind: "none" }
  | { kind: "starting"; request: EmbedRequest }
  | { kind: "converting"; url: string }
  | { kind: "loading" }
  | { kind: "mismatch"; recipeHost: string; pageHost: string; url: string }
  | { kind: "error"; error: FriendlyError; url: string | null }
  | {
      kind: "ready";
      artifact: CookAlongArtifact;
      notices: string[];
      /** The quick read from a streamed conversion, when there was one. */
      overview?: RecipeOverview | null;
    };

/** The conversion as it streams in, and the adjustments queued meanwhile. */
export interface EmbedProgress {
  conversion: ConversionState;
  queued: AdjustChoices | null;
  onQueue: (choices: AdjustChoices | null) => void;
}

const HANDOFF_TIMEOUT_MS = 8000;

/** First render, identical on server and client. */
export function initialEmbedState(request: EmbedRequest): EmbedState {
  return request.kind === "none" ? { kind: "none" } : { kind: "starting", request };
}

/**
 * The adjustment the /embed address asked for (the "Adjust with SOUS" menu),
 * as adjust-panel choices for a recipe that serves `base`. Null until the
 * recipe's servings are known. Pure.
 */
export function requestedChoices(adjust: EmbedAdjust | null | undefined, base: number | null): AdjustChoices | null {
  if (!adjust || base === null) return null;
  return {
    servings: adjust.servings ?? base,
    dietary: adjust.dietary ?? "",
    cuisine: adjust.cuisine ?? "",
    sousVoice: false,
  };
}

/** Where the overlay is: still working, showing the cook along, or stopped (error, mismatch, none). */
export type EmbedStage = "working" | "ready" | "stopped";

export function embedStage(state: EmbedState): EmbedStage {
  if (state.kind === "ready") return "ready";
  return state.kind === "starting" || state.kind === "loading" || state.kind === "converting" ? "working" : "stopped";
}

/**
 * The calm line at the top while the asked-for adjustment is on its way
 * ("Scaling to 18 servings…"), from the first moment until the adjusted cook
 * along shows or the adjustment fails (`settled`). None once the reader
 * changes the queued choices themselves, or when the recipe already is what
 * was asked (serves 18 already). Pure.
 */
export function workingLine(input: {
  adjust: EmbedAdjust | null | undefined;
  stage: EmbedStage;
  /** The recipe's servings, once known. */
  base: number | null;
  ownQueue: boolean;
  settled: boolean;
}): string | null {
  const { adjust, base } = input;
  if (!adjust || input.ownQueue || input.settled || input.stage === "stopped") return null;
  if (base === null) return adjustLine(adjust) || null;
  const choices = requestedChoices(adjust, base);
  if (!choices || !hasAdjustment(choices, base)) return null;
  // The recipe may already serve what was asked: say only what changes.
  const shown: EmbedAdjust = adjust.servings === base ? { ...adjust, servings: undefined } : adjust;
  return adjustLine(shown) || null;
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
  progress,
}: {
  state: Exclude<EmbedState, { kind: "ready" }>;
  onClose?: () => void;
  /** While converting: the parts that have arrived so far. */
  progress?: EmbedProgress;
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
        <>
          <section className={styles.status}>
            <h1 className={styles.title}>Turning this recipe into a Cook Along…</h1>
            <p>
              Converting the recipe{host ? ` from ${host}` : ""}. Each part shows here as soon as
              it&apos;s ready. You stay on this page the whole time.
            </p>
          </section>
          <ProgressiveView
            state={progress?.conversion ?? STARTED}
            queued={progress?.queued ?? null}
            onQueue={progress?.onQueue ?? (() => {})}
          />
        </>
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

/** A conversion that has started but heard nothing yet. */
const STARTED: ConversionState = { ...initialConversionState, status: "working" };

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
  // The conversion streams in part by part (useConversion keeps the screen on).
  const conversion = useConversion();
  const startConversion = conversion.start;
  // Adjustments chosen before the cook along is ready, applied when it is. The
  // address's own (?servings=, ?dietary=, ?cuisine=) count until the reader
  // changes the queued choices in the panel.
  const [queued, setQueued] = useState<AdjustChoices | null>(null);
  const [ownQueue, setOwnQueue] = useState(false);
  const [settled, setSettled] = useState(false);
  const requested = request.kind === "none" ? null : (request.adjust ?? null);
  const onQueue = useCallback((choices: AdjustChoices | null) => {
    setOwnQueue(true);
    setQueued(choices);
  }, []);
  const onQueuedApplied = useCallback(() => setSettled(true), []);

  const close = useCallback(() => {
    if (!inFrame()) return;
    // The message carries no data, so "*" is safe when the parent origin is unknown.
    window.parent.postMessage({ type: EMBED_CLOSE_MESSAGE }, parentOrigin() ?? "*");
  }, []);

  const convert = useCallback(
    async (url: string) => {
      setState({ kind: "converting", url });
      const final = await startConversion({ url });
      if (!final) return;
      if (final.status === "done" && final.artifact) {
        setState({ kind: "ready", artifact: final.artifact, notices: final.notices, overview: final.overview });
        return;
      }
      // Same copy as the JSON answers: the 429 reason, the recipe URL, "may still finish".
      setState({ kind: "error", error: final.error ?? convertFailure({ status: null, timeout: false, data: null }, url), url });
    },
    [startConversion],
  );

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
  const base =
    state.kind === "ready" ? state.artifact.recipe.servings : (conversion.state.recipe?.nativeServings ?? null);
  const queuedNow = ownQueue ? queued : requestedChoices(requested, base);
  const line = workingLine({ adjust: requested, stage: embedStage(state), base, ownQueue, settled });

  return (
    <div className={`ts-embed-root ${styles.root}`} onClickCapture={onClickCapture}>
      <main className={styles.main}>
        {line ? (
          <p className={styles.workingLine} role="status">
            {line}
          </p>
        ) : null}
        {state.kind === "ready" ? (
          <ArtifactViewer
            artifact={state.artifact}
            notices={state.notices}
            overview={state.overview ?? null}
            queuedAdjustments={queuedNow}
            onQueuedApplied={onQueuedApplied}
            embedded
            onClose={onClose}
            onStartOver={() => {
              window.location.href = window.location.origin;
            }}
          />
        ) : (
          <EmbedStatus
            state={state}
            onClose={onClose}
            progress={{ conversion: conversion.state, queued: queuedNow, onQueue }}
          />
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
