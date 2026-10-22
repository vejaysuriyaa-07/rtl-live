// Integration suite against a packaged (unzipped vsix) copy of the extension.
// Used by scripts/test-packaged.mjs; do not run directly.
import { defineConfig } from "@vscode/test-cli";

const extensionDir = process.env["RTL_LIVE_PACKAGED_DIR"];
if (!extensionDir) throw new Error("RTL_LIVE_PACKAGED_DIR is not set (run scripts/test-packaged.mjs)");
const fromPath = process.env["RTL_LIVE_VSCODE_PATH"];
const extensionsDir = process.env["RTL_LIVE_EXTENSIONS_DIR"];
const launchArgs = ["--disable-workspace-trust"];
if (extensionsDir) launchArgs.push(`--extensions-dir=${extensionsDir}`);
else launchArgs.push("--disable-extensions");

export default defineConfig({
  files: "dist/test/integration/**/*.test.js",
  extensionDevelopmentPath: extensionDir,
  workspaceFolder: "test/fixtures",
  version: process.env["RTL_LIVE_VSCODE_VERSION"] ?? "stable",
  ...(fromPath ? { useInstallation: { fromPath } } : {}),
  mocha: {
    ui: "tdd",
    timeout: 60_000,
  },
  launchArgs,
});
