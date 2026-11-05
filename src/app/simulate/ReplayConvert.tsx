"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import ArtifactViewer from "../ArtifactViewer";
import ErrorBox from "../ErrorBox";
import ProgressiveView from "../ProgressiveView";
import { useConversion } from "../useConversion";
import { MUFFINS_URL, muffinsRecording } from "./recordings";
import { ADJUST_NOTE, recordingDuration, replaySource, SIMULATION_NOTE } from "./replay";
import ReplayBar from "./ReplayBar";
import { useReplay } from "./useReplay";

/**
 * /simulate/convert: the muffins conversion replayed through the same hook,
 * reducer, progressive view and finished page as a live conversion, from
 * the recording instead of the server. Apply is off: adjustments are live
 * on the real page.
 */
export default function ReplayConvert({ speed }: { speed: number }) {
  const router = useRouter();
  const recording = useMemo(() => muffinsRecording(), []);
  const replay = useReplay(speed);
  const source = useMemo(() => replaySource(recording, replay.player), [recording, replay.player]);
  const { state, start } = useConversion(undefined, source);
  const body = useMemo(() => ({ url: MUFFINS_URL }), []);

  useEffect(() => {
    const id = setTimeout(() => void start(body), 0);
    return () => clearTimeout(id);
  }, [start, body]);

  function restart() {
    replay.restart();
    window.scrollTo(0, 0);
    void start(body);
  }

  return (
    <div className="replay-page">
      <p className="notice" role="note">
        {SIMULATION_NOTE}. Nothing here calls the model.
      </p>
      {state.status === "done" && state.artifact ? (
        <ArtifactViewer
          artifact={state.artifact}
          overview={state.overview}
          notices={state.notices}
          built
          adjustNote={ADJUST_NOTE}
          onStartOver={() => router.push("/")}
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
        total={recordingDuration(recording)}
        playing={replay.playing}
        onToggle={replay.toggle}
        onSpeed={replay.setSpeed}
        onRestart={restart}
      />
    </div>
  );
}
