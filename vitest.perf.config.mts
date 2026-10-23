import { defineConfig } from "vitest/config";

// Timing assertions run alone: npm run test:perf.
export default defineConfig({
  test: {
    include: ["test/perf/**/*.test.ts"],
    exclude: ["node_modules", "dist", ".vscode-test"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: "forks",
    fileParallelism: false,
  },
});
