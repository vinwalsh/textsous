import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "TextSous Open",
  description: "Convert any recipe into the TextSous Cook Along format.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="site-footer">
          <p>
            Converted recipes are private to you: they are never listed, indexed, or shared,
            and photos are processed in memory and never stored.
          </p>
          <p>
            Recipe takedown requests:{" "}
            <a href="mailto:privacy@textsous.com">privacy@textsous.com</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
