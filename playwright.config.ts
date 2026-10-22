import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/webview",
  outputDir: "artifacts/playwright",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    headless: true,
    viewport: { width: 900, height: 600 },
  },
});
