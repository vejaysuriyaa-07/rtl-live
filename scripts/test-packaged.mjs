// Regression check for "works in the dev host, blank in the installed vsix":
// builds the production bundles, packages the vsix with vsce, unzips it into a
// temp dir and runs the integration suite against that copy
// (.vscode-test.packaged.mjs), so the tests see exactly the files a user installs.
//
// VS Code runs with a throwaway profile (test/isolation.mjs).
//
//   npm run test:packaged                      # VS Code stable (downloaded once into .vscode-test/)
//   RTL_LIVE_VSCODE_VERSION=1.106.3 npm run test:packaged
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname, "..");
const run = (cmd, args, opts = {}) => {
  console.log(`[test-packaged] ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
  if (r.status !== 0) {
    console.error(`[test-packaged] ${cmd} exited with ${r.status}`);
    process.exit(r.status ?? 1);
  }
};

const work = mkdtempSync(join(tmpdir(), "rtl-live-packaged-"));
try {
  run("npm", ["run", "build:prod"]);
  const vsix = join(work, "rtl-live.vsix");
  run("npx", ["vsce", "package", "--no-dependencies", "--out", vsix]);
  execFileSync("unzip", ["-q", vsix, "-d", join(work, "unpacked")]);
  const extensionDir = join(work, "unpacked", "extension");
  for (const f of ["package.json", "dist/extension.js", "dist/webview.js", "dist/webview.css", "dist/elkWorker.js", "dist/web-tree-sitter.wasm", "dist/tree-sitter-verilog.wasm"]) {
    if (!existsSync(join(extensionDir, f))) {
      console.error(`[test-packaged] vsix is missing ${f}`);
      process.exit(1);
    }
  }
  console.log(`[test-packaged] packaged files: ${readdirSync(join(extensionDir, "dist")).join(", ")}`);
  run("npx", ["vscode-test", "--config", ".vscode-test.packaged.mjs"], { env: { ...process.env, RTL_LIVE_PACKAGED_DIR: extensionDir } });
  console.log("[test-packaged] integration suite passed against the packaged extension");
} finally {
  rmSync(work, { recursive: true, force: true });
}
