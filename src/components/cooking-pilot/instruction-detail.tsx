"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cookingDisplayText } from "@/lib/cooking-pilot/display-text";
import { instructionDisplay, isExactInstructionPartition, type InstructionPart } from "@/lib/cooking-pilot/instruction-display";
import { INSTRUCTION_DETAIL_STORAGE_KEY, parseInstructionDetail, readInstructionDetail, saveInstructionDetail,
  type InstructionDetail } from "./instruction-preference";
import styles from "./instruction-detail.module.css";

export function useInstructionDetailPreference() {
  const [detailLevel, setDetailLevel] = useState<InstructionDetail>("with-tips");
  useEffect(() => {
    // Read once after hydration; never overwrite a saved preference on mount.
    const restore = window.setTimeout(() => {
      try { setDetailLevel(readInstructionDetail(window.localStorage)); } catch { /* Storage may be unavailable. */ }
    }, 0);
    const onStorage = (event: StorageEvent) => {
      if (event.key === INSTRUCTION_DETAIL_STORAGE_KEY || event.key === null) setDetailLevel(parseInstructionDetail(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => { window.clearTimeout(restore); window.removeEventListener("storage", onStorage); };
  }, []);
  const changeDetailLevel = useCallback((next: InstructionDetail) => {
    setDetailLevel(next);
    // A blocked/full store must not prevent this cook from using the control.
    try { saveInstructionDetail(window.localStorage, next); } catch { /* Keep the in-memory preference. */ }
  }, []);
  return { detailLevel, changeDetailLevel };
}

export function InstructionDetailControl({ value, onChange }: { value: InstructionDetail; onChange: (value: InstructionDetail) => void }) {
  return <div className={styles.control} role="group" aria-label="Instruction detail">
    <div className={styles.options}>
      <button type="button" aria-pressed={value === "with-tips"} onClick={() => onChange("with-tips")}>With tips</button>
      <button type="button" aria-pressed={value === "essentials"} onClick={() => onChange("essentials")}>Essentials</button>
    </div>
  </div>;
}

interface InstructionProps {
  text: string;
  parts?: readonly InstructionPart[];
  detailLevel: InstructionDetail;
}

/** Match against the final displayed wording, including personal timing edits.
 * A stale split keeps that complete wording visible through the helper fallback. */
export function InstructionText({ text, parts, detailLevel }: InstructionProps) {
  const displayed = cookingDisplayText(text);
  return <p data-instruction-copy>{detailLevel === "essentials" ? instructionDisplay(displayed, parts).essential : displayed}</p>;
}

/** Place after always-visible readiness cues/checkpoints in task details. */
export function InstructionExtras({ text, parts, detailLevel, tip, tipClassName }: InstructionProps & { tip?: string; tipClassName?: string }) {
  const displayed = cookingDisplayText(text);
  // Legacy or stale copy has no matching review of what can safely be hidden.
  // Preserve its existing tip along with the complete instruction fallback.
  if (detailLevel === "with-tips" || !isExactInstructionPartition(displayed, parts)) {
    return tip ? <p className={tipClassName ?? styles.tip}>{cookingDisplayText(tip)}</p> : null;
  }
  const projected = instructionDisplay(displayed, parts);
  if (!projected.explanations.length && !tip) return null;
  return <details key={text} className={styles.extras} data-instruction-extras>
    <summary><span>{projected.explanations.length ? tip ? "Why & tips" : "Why this works" : "Show tip"}</span><ChevronDown size={16} aria-hidden="true" /></summary>
    {projected.explanations.map((explanation, index) => <p key={index}>{explanation}</p>)}
    {tip && <p>{cookingDisplayText(tip)}</p>}
  </details>;
}
