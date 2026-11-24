import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/__tests__/marketingAccess.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
