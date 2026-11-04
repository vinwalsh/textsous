"use client";

import { useRouter } from "next/navigation";
import type { CookAlongArtifact } from "../../lib/schema/artifact";
import ArtifactViewer from "../ArtifactViewer";

/** The finished page for the demo artifact; "Convert another recipe" goes to the converter. */
export default function DemoCookAlong({ artifact }: { artifact: CookAlongArtifact }) {
  const router = useRouter();
  return <ArtifactViewer artifact={artifact} onStartOver={() => router.push("/")} />;
}
