// Integration suite against a packaged (unzipped vsix) copy of the extension.
// Used by scripts/test-packaged.mjs; do not run directly. Same isolation as
// .vscode-test.mjs (throwaway profile, private fixture copy).
import { defineConfig } from "@vscode/test-cli";
import { isolatedLaunch } from "./test/isolation.mjs";

const extensionDir = process.env["RTL_LIVE_PACKAGED_DIR"];
if (!extensionDir) throw new Error("RTL_LIVE_PACKAGED_DIR is not set (run scripts/test-packaged.mjs)");

const launch = isolatedLaunch("pk");

export default defineConfig({
  files: "dist/test/integration/**/*.test.js",
  extensionDevelopmentPath: extensionDir,
  workspaceFolder: launch.workspaceFolder,
  version: process.env["RTL_LIVE_VSCODE_VERSION"] ?? "stable",
  mocha: {
    ui: "tdd",
    timeout: 60_000,
  },
  launchArgs: launch.launchArgs,
});
