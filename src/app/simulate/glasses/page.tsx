import type { Metadata, Viewport } from "next";
import { GLASSES_SPEEDS, parseSpeed } from "../replay";
import ReplayGlasses from "../ReplayGlasses";
import "../../glasses/glasses.css";

export const metadata: Metadata = {
  title: "Glasses replay · TextSous",
  description: "The heads-up Cook Along on a recorded conversion, its guide clock running faster than real time.",
  robots: { index: false, follow: false },
};

/** Light on black, like /glasses. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
  colorScheme: "dark",
};

/** `?speed=` 1, 5, 10, 20 or 60 (default 20): how much faster the guide clock runs. */
export default async function SimulateGlassesPage({
  searchParams,
}: {
  searchParams: Promise<{ speed?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <main>
      <ReplayGlasses speed={parseSpeed(params.speed, GLASSES_SPEEDS, 20)} />
    </main>
  );
}
