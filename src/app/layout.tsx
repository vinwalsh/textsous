import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { fredoka, inter } from "./fonts";
import SiteFooter from "./SiteFooter";
import SiteHeader from "./SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "TextSous Open",
  description:
    "Turn any recipe into a calm, step-by-step TextSous Cook Along: your mise en place first, then timed steps.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FAF8F5",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fredoka.variable}`}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
