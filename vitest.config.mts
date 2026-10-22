import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts", "test/golden/**/*.test.ts", "test/accuracy/**/*.test.ts"],
    exclude: ["node_modules", "dist", ".vscode-test"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
