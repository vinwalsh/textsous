"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  initialConversionState,
  reduceConversion,
  runConversion,
  type ConversionAction,
  type ConversionEventSource,
  type ConversionState,
  type ConvertBody,
} from "./conversion";
import { withScreenOn } from "./wake-lock";

export interface Conversion {
  state: ConversionState;
  /**
   * Convert a recipe, filling `state` as each part arrives. Resolves with the
   * final state, or null when a newer start or a reset replaced this one.
   */
  start: (body: ConvertBody) => Promise<ConversionState | null>;
  /** Back to idle; a conversion still running is let go (the server finishes it). */
  reset: () => void;
}

/**
 * The progressive conversion as React state (see conversion.ts). `source`
 * replaces the server with other events (a replay, /simulate); the live
 * pages pass nothing.
 */
export function useConversion(fetchImpl?: typeof fetch, source?: ConversionEventSource): Conversion {
  const [state, dispatch] = useReducer(reduceConversion, initialConversionState);
  const runs = useRef({ latest: 0, live: new Set<AbortController>() });

  // Leaving the page stops reading the stream.
  useEffect(() => {
    const current = runs.current;
    return () => {
      current.live.forEach((controller) => controller.abort());
      current.live.clear();
    };
  }, []);

  const start = useCallback(
    async (body: ConvertBody): Promise<ConversionState | null> => {
      const current = runs.current;
      current.live.forEach((controller) => controller.abort());
      current.live.clear();
      current.latest += 1;
      const id = current.latest;
      const controller = new AbortController();
      current.live.add(controller);
      const send = (action: ConversionAction): void => {
        if (current.latest === id) dispatch(action);
      };
      try {
        // Keep the phone's screen on: a lock drops the request.
        const final = await withScreenOn(() =>
          runConversion(body, send, {
            signal: controller.signal,
            ...(fetchImpl ? { fetchImpl } : {}),
            ...(source ? { source } : {}),
          }),
        );
        return current.latest === id ? final : null;
      } finally {
        current.live.delete(controller);
      }
    },
    [fetchImpl, source],
  );

  const reset = useCallback(() => {
    const current = runs.current;
    current.latest += 1;
    current.live.forEach((controller) => controller.abort());
    current.live.clear();
    dispatch({ type: "reset" });
  }, []);

  return { state, start, reset };
}
