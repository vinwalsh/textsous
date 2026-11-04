import type { NextConfig } from "next";

/**
 * Framing (docs/EMBED.md): only /embed may be framed by other sites, because
 * embed.js shows it in an overlay on recipe pages. Every other route allows
 * same-origin framing only. /embed.js is cached briefly so fixes roll out fast.
 */
export const EMBED_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors *" },
];

export const SITE_FRAME_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
];

export const EMBED_SCRIPT_HEADERS = [
  { key: "Cache-Control", value: "public, max-age=300, s-maxage=3600" },
  { key: "Access-Control-Allow-Origin", value: "*" },
];

const nextConfig: NextConfig = {
  // `next dev` would otherwise write a managed block into AGENTS.md, which is
  // this repo's own hand-written agent guide (Next 16.3+ option).
  agentRules: false,
  async headers() {
    return [
      // Every path except exactly /embed (so /embed-demo and /embed.js stay protected).
      { source: "/:path((?!embed$).*)", headers: SITE_FRAME_HEADERS },
      { source: "/embed", headers: EMBED_HEADERS },
      { source: "/embed.js", headers: EMBED_SCRIPT_HEADERS },
    ];
  },
};

export default nextConfig;
