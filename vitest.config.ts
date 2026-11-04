import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The tsconfig "@/*" path, for the Cook Along view's modules.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // next/font loaders only run inside the Next compiler; tests use a stand-in.
      "next/font/google": fileURLToPath(new URL("./tests/helpers/next-font-google.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
