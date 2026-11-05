import type { Metadata } from "next";
import { parseSpeed, REPLAY_SPEEDS } from "../replay";
import ReplayPhoto from "../ReplayPhoto";

export const metadata: Metadata = {
  title: "Photo conversion replay · TextSous Open",
  description: "Two photographed cookbook pages, read and converted once on Nov 4, 2026, replayed through the live page's components.",
  robots: { index: false, follow: false },
};

/** `?speed=` 1, 2, 4, 8 or 16 (default 4). */
export default async function SimulatePhotoPage({
  searchParams,
}: {
  searchParams: Promise<{ speed?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <main>
      <h1 className="visually-hidden">Simulation: a recorded photo conversion replayed</h1>
      <ReplayPhoto speed={parseSpeed(params.speed, REPLAY_SPEEDS, 4)} />
    </main>
  );
}
