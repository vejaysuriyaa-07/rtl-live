import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "dist/test/integration/**/*.test.js",
  workspaceFolder: "test/fixtures",
  version: "stable",
  mocha: {
    ui: "tdd",
    timeout: 60_000,
  },
  launchArgs: ["--disable-extensions", "--disable-workspace-trust"],
});
