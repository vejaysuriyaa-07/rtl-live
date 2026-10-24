// Isolated VS Code launch for the integration suites (.vscode-test.mjs and
// .vscode-test.packaged.mjs). Every run gets a fresh temp folder with its own
// --user-data-dir and --extensions-dir, and a private copy of test/fixtures as
// the workspace, so tests never touch the real profile, the real extensions
// folder or the fixtures in the repository. The folder is removed when the
// test CLI process exits. With RTL_LIVE_IT_ROOT set (CI does this), the folder
// is <RTL_LIVE_IT_ROOT>/<label> instead, emptied first and kept afterwards, so
// the VS Code logs of the profile can be uploaded when a test fails.
import { fileURLToPath } from "node:url";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const REPO_FIXTURES = join(REPO_ROOT, "test", "fixtures");

/**
 * @param {string} label short tag for the temp folder name
 * @returns {{ root: string, userDataDir: string, extensionsDir: string, workspaceFolder: string, launchArgs: string[] }}
 */
export function isolatedLaunch(label) {
  // Keep the path short: VS Code's IPC socket lives under user-data-dir and
  // macOS limits socket paths to about 100 characters.
  const keepRoot = process.env["RTL_LIVE_IT_ROOT"];
  let root;
  if (keepRoot) {
    root = join(resolve(keepRoot), label);
    // macOS limits socket paths to about 104 bytes and VS Code's IPC socket lives under ud/.
    if (process.platform === "darwin" && root.length > 80) throw new Error(`RTL_LIVE_IT_ROOT is too long for the macOS socket path limit: ${root} (${root.length} chars, keep it under 80)`);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  } else {
    root = mkdtempSync(join(tmpdir(), `rl-${label}-`));
  }
  const userDataDir = join(root, "ud");
  const extensionsDir = join(root, "ext");
  const workspaceFolder = join(root, "fixtures");
  cpSync(REPO_FIXTURES, workspaceFolder, { recursive: true });
  if (!keepRoot) {
    process.on("exit", () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // best effort
      }
    });
  }
  return {
    root,
    userDataDir,
    extensionsDir,
    workspaceFolder,
    launchArgs: [
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-telemetry",
    ],
  };
}
