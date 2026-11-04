import { Fredoka, Inter } from "next/font/google";

/** Every piece of UI text. Exposed as --font-inter on <html>. */
export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/** The "TextSous" wordmark only. Exposed as --font-fredoka on <html>. */
export const fredoka = Fredoka({
  subsets: ["latin"],
  weight: "600",
  display: "swap",
  variable: "--font-fredoka",
});
