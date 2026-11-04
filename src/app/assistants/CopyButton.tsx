"use client";

import { useState } from "react";
import styles from "./assistants.module.css";

/** Copies `text` to the clipboard and says so in a live region. */
export default function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    setTimeout(() => setStatus("idle"), 2500);
  }

  return (
    <span className={styles.copyWrap}>
      <button type="button" className={styles.copyButton} onClick={() => void copy()}>
        {label}
      </button>
      <span className={styles.copyStatus} role="status" aria-live="polite">
        {status === "copied" ? "Copied" : status === "failed" ? "Select the text and copy it" : ""}
      </span>
    </span>
  );
}
