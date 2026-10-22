// Isolated VS Code launch for the integration suites (.vscode-test.mjs and
// .vscode-test.packaged.mjs). Every run gets a fresh temp folder with its own
// --user-data-dir and --extensions-dir, and a private copy of test/fixtures as
// the workspace, so tests never touch the real profile, the real extensions
// folder or the fixtures in the repository. The folder is removed when the
// test CLI process exits.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
export const REPO_FIXTURES = join(REPO_ROOT, "test", "fixtures");

/**
 * @param {string} label short tag for the temp folder name
 * @returns {{ root: string, userDataDir: string, extensionsDir: string, workspaceFolder: string, launchArgs: string[] }}
 */
export function isolatedLaunch(label) {
  // Keep the path short: VS Code's IPC socket lives under user-data-dir and
  // macOS limits socket paths to about 100 characters.
  const root = mkdtempSync(join(tmpdir(), `rl-${label}-`));
  const userDataDir = join(root, "ud");
  const extensionsDir = join(root, "ext");
  const workspaceFolder = join(root, "fixtures");
  cpSync(REPO_FIXTURES, workspaceFolder, { recursive: true });
  process.on("exit", () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });
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
