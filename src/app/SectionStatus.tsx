import type { ReactNode } from "react";
import {
  BEFORE_CHANGES,
  isBusy,
  SECTION_TITLES,
  type SectionKey,
  type SectionPhase,
  type SectionState,
} from "./section-states";

/**
 * A small spinner beside a heading or a note: "work" while the cook along is
 * written, "adjust" (a different look) while an adjustment applies. It stops
 * turning under prefers-reduced-motion (globals.css).
 */
export function Spinner({ kind = "work" }: { kind?: "work" | "adjust" }) {
  return <span className={kind === "adjust" ? "ts-spinner ts-spinner-adjust" : "ts-spinner"} aria-hidden="true" />;
}

/** "✓ Ready" beside a heading that just filled in; it fades after a moment. */
export function ReadyMark() {
  return (
    <span className="section-ready">
      <span aria-hidden="true">✓</span> Ready
    </span>
  );
}

export const PHASE_LABELS: Record<SectionPhase, string> = {
  coming: "Coming up",
  working: "Working on it",
  checking: "Checking",
  ready: "Ready",
};

/** The phase beside a placeholder's heading: a spinner only while it is being written. */
export function PhasePill({ phase }: { phase: SectionPhase }) {
  return (
    <span className={`section-phase section-phase-${phase}`}>
      {isBusy(phase) ? <Spinner /> : null}
      {PHASE_LABELS[phase]}
    </span>
  );
}

/** A spinner and one muted line under a heading, e.g. "Checking against the original…". */
export function WorkingNote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`meta section-note ${className}`.trim()}>
      <Spinner /> {children}
    </p>
  );
}

/**
 * "Before your changes" on a section a queued adjustment will change; while
 * it applies, a second spinner and what it is doing ("Adjusting: serves 2 →
 * 18 · Vegan…").
 */
export function PreAdjustMark({ adjusting = null }: { adjusting?: string | null }) {
  return (
    <p className="pre-adjust">
      <span className="pre-adjust-badge">{BEFORE_CHANGES}</span>
      {adjusting ? (
        <span className="adjusting-note">
          <Spinner kind="adjust" /> {adjusting}
        </span>
      ) : null}
    </p>
  );
}

/**
 * A section that has not filled in yet, in its place on the page: its
 * heading, its phase (Coming up, or Working on it with a spinner) and one
 * muted line. aria-busy while it is being written.
 */
export function SectionPlaceholder({
  section,
  state,
  level = 3,
  mark,
}: {
  section: SectionKey;
  state: SectionState;
  /** The heading level the finished section uses. */
  level?: 2 | 3;
  /** "Before your changes", when a queued adjustment will change it. */
  mark?: ReactNode;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  const busy = isBusy(state.phase);
  return (
    <section
      className={`card section-slot section-slot-${state.phase}`}
      aria-labelledby={`section-slot-${section}`}
      aria-busy={busy ? true : undefined}
      data-section={section}
    >
      <div className="section-slot-head">
        <Heading id={`section-slot-${section}`} className="section-slot-title">
          {SECTION_TITLES[section]}
        </Heading>
        <PhasePill phase={state.phase} />
      </div>
      {state.note ? <p className="meta section-slot-note">{state.note}</p> : null}
      {mark}
    </section>
  );
}
