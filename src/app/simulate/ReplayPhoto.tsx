"use client";

import { useEffect, useMemo, useState } from "react";
import ArtifactViewer from "../ArtifactViewer";
import ErrorBox from "../ErrorBox";
import PhotoConfirm from "../PhotoConfirm";
import { pageLabel } from "../photo-pages";
import ProgressiveView from "../ProgressiveView";
import ProgressNote from "../ProgressNote";
import { useConversion } from "../useConversion";
import { CORNBREAD_PAGES, cornbreadPhoto, cornbreadRecording, TRANSCRIBE_SECONDS } from "./recordings";
import { ADJUST_NOTE, recordingDuration, replaySource, SIMULATION_NOTE } from "./replay";
import ReplayBar from "./ReplayBar";
import { useReplay } from "./useReplay";

type Phase = "transcribing" | "confirm" | "converting";

/**
 * /simulate/photo: the two cornbread pages, the transcription wait (about
 * 20 s of real time, at the replay speed), the real confirm screen with
 * the recorded transcription, then the recorded conversion through the
 * same views as a live one. The clock pauses on the confirm screen, as a
 * cook would, and restarts with the conversion.
 */
export default function ReplayPhoto({ speed }: { speed: number }) {
  const photo = useMemo(() => cornbreadPhoto(), []);
  const recording = useMemo(() => cornbreadRecording(), []);
  const replay = useReplay(speed);
  const { player } = replay;
  const source = useMemo(() => replaySource(recording, player), [recording, player]);
  const { state, start, reset } = useConversion(undefined, source);
  const [phase, setPhase] = useState<Phase>("transcribing");

  // The transcription takes its recorded time on the replay clock.
  useEffect(() => {
    if (phase !== "transcribing") return;
    const controller = new AbortController();
    void player.waitUntil(TRANSCRIBE_SECONDS, controller.signal).then(() => {
      if (controller.signal.aborted) return;
      player.pause();
      setPhase("confirm");
      window.scrollTo(0, 0);
    });
    return () => controller.abort();
  }, [phase, player]);

  function confirm() {
    setPhase("converting");
    replay.restart();
    window.scrollTo(0, 0);
    void start({ recipe: photo.recipe });
  }

  function backToPhotos() {
    reset();
    replay.restart();
    setPhase("transcribing");
    window.scrollTo(0, 0);
  }

  // Restart: the phase on screen from its start (the conversion again, or the photos).
  function restart() {
    if (phase === "converting") {
      replay.restart();
      window.scrollTo(0, 0);
      void start({ recipe: photo.recipe });
      return;
    }
    backToPhotos();
  }

  const total = phase === "converting" ? recordingDuration(recording) : TRANSCRIBE_SECONDS;

  return (
    <div className="replay-page">
      <p className="notice" role="note">
        {SIMULATION_NOTE}. The photos were read once, on Nov 4; nothing here calls the model.
      </p>
      {phase === "transcribing" ? (
        <section aria-label="Convert a recipe" className="card converter">
          <div className="field">
            <span id="replay-photo-pages">Photos of the recipe</span>
            <ol className="photo-pages replay-photo-pages" aria-labelledby="replay-photo-pages">
              {CORNBREAD_PAGES.map((page, i) => (
                <li key={page.url} className="photo-page">
                  {/* Static files under public/: a plain img keeps this the same markup as the live picker. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={page.url} alt="" className="photo-thumb" />
                  <span className="photo-page-text">
                    <strong>{pageLabel(i)}</strong>
                    <span className="meta">{page.name}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled>
              Transcribing… (replay)
            </button>
          </div>
          <ProgressNote kind="transcribe" />
        </section>
      ) : phase === "confirm" ? (
        <PhotoConfirm
          photoUrl={CORNBREAD_PAGES[0].url}
          fileName={CORNBREAD_PAGES[0].name}
          pages={CORNBREAD_PAGES}
          notices={photo.warnings}
          recipe={photo.recipe}
          transcription={photo.transcription}
          busy={false}
          error={null}
          onConfirm={confirm}
          onRetake={backToPhotos}
        />
      ) : state.status === "done" && state.artifact ? (
        <ArtifactViewer
          artifact={state.artifact}
          overview={state.overview}
          notices={state.notices}
          built
          adjustNote={ADJUST_NOTE}
          onStartOver={backToPhotos}
        />
      ) : state.status === "working" ? (
        <ProgressiveView state={state} queued={null} onQueue={() => {}} adjustNote={ADJUST_NOTE} />
      ) : state.status === "failed" ? (
        <ErrorBox error={state.error ?? { title: "The replay stopped", detail: "Restart it from the bar." }} />
      ) : (
        <p className="meta">Starting the replay…</p>
      )}
      <ReplayBar
        speed={replay.speed}
        elapsed={replay.elapsed}
        total={total}
        playing={replay.playing}
        onToggle={replay.toggle}
        onSpeed={replay.setSpeed}
        onRestart={restart}
      />
    </div>
  );
}
