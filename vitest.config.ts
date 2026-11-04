import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // next/font loaders only run inside the Next compiler; tests use a stand-in.
      "next/font/google": fileURLToPath(new URL("./tests/helpers/next-font-google.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
