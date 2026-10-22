// Integration suite (dev bundles in dist/). Launches VS Code with a throwaway
// profile and a private copy of the fixtures; see test/isolation.mjs.
import { defineConfig } from "@vscode/test-cli";
import { isolatedLaunch } from "./test/isolation.mjs";

const launch = isolatedLaunch("it");

export default defineConfig({
  files: "dist/test/integration/**/*.test.js",
  workspaceFolder: launch.workspaceFolder,
  version: process.env["RTL_LIVE_VSCODE_VERSION"] ?? "stable",
  mocha: {
    ui: "tdd",
    timeout: 60_000,
  },
  launchArgs: launch.launchArgs,
});
