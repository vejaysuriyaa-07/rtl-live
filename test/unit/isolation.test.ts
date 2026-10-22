// Guard: every VS Code launched by the test suites uses a throwaway profile
// and a private copy of the fixtures. Fails if a config or test points at the
// real profile, the real extensions folder or test/fixtures directly.
import { readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ROOT } from "./helpers";

interface LaunchConfig {
  workspaceFolder?: string;
  launchArgs?: string[];
  extensionDevelopmentPath?: string;
}

const TMP = realpathSync(tmpdir());
const REPO_FIXTURES = join(ROOT, "test", "fixtures");
const FORBIDDEN = [/Application Support\/Code/, /\.vscode\/extensions/, /fromMachine/, /~\/Applications/, /RTL_LIVE_EXTENSIONS_DIR/, /RTL_LIVE_VSCODE_PATH/];

function argValue(args: string[], name: string): string | undefined {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a?.slice(name.length + 3);
}

async function loadConfig(file: string): Promise<LaunchConfig> {
  const mod = (await import(/* @vite-ignore */ join(ROOT, file))) as { default: LaunchConfig | LaunchConfig[] };
  const cfg = Array.isArray(mod.default) ? mod.default[0] : mod.default;
  expect(cfg).toBeDefined();
  return cfg!;
}

describe("test isolation", () => {
  // Importing a config creates its temp folder; vitest workers can end without
  // running exit hooks, so remove what this test created.
  const created: string[] = [];
  afterAll(() => {
    for (const d of created) rmSync(d, { recursive: true, force: true });
  });

  for (const file of [".vscode-test.mjs", ".vscode-test.packaged.mjs"]) {
    it(`${file} launches VS Code with a temp profile and a fixture copy`, async () => {
      process.env["RTL_LIVE_PACKAGED_DIR"] ??= join(ROOT, "dist");
      const cfg = await loadConfig(file);
      const args = cfg.launchArgs ?? [];
      const userData = argValue(args, "user-data-dir");
      const extensions = argValue(args, "extensions-dir");
      expect(userData, "--user-data-dir").toBeDefined();
      expect(extensions, "--extensions-dir").toBeDefined();
      created.push(dirname(userData!));
      for (const dir of [userData!, extensions!, cfg.workspaceFolder!]) {
        const real = resolve(dir);
        expect(real.startsWith(TMP) || real.startsWith(tmpdir()), `${dir} is not under the temp dir`).toBe(true);
        expect(real.startsWith(homedir() + "/Library")).toBe(false);
        expect(real.startsWith(join(homedir(), ".vscode"))).toBe(false);
      }
      expect(resolve(cfg.workspaceFolder!)).not.toBe(REPO_FIXTURES);
      expect(resolve(cfg.workspaceFolder!).startsWith(REPO_FIXTURES)).toBe(false);
      expect(args).toContain("--disable-extensions");
      // The user-data-dir socket path must stay under the macOS limit.
      expect(`${userData}/1.99-main.sock`.length).toBeLessThan(104);
    });
  }

  it("no test config, script or test file references the real profile or extensions folder", () => {
    const files = [
      ".vscode-test.mjs",
      ".vscode-test.packaged.mjs",
      "playwright.config.ts",
      "scripts/test-packaged.mjs",
      "test/isolation.mjs",
      ...readdirSync(join(ROOT, "test", "integration")).map((f) => `test/integration/${f}`),
      ...readdirSync(join(ROOT, "test", "webview")).map((f) => `test/webview/${f}`),
    ];
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), "utf8");
      for (const re of FORBIDDEN) expect(text, `${f} matches ${re}`).not.toMatch(re);
    }
  });

  it("integration tests open fixtures only through the temp workspace helper", () => {
    for (const f of readdirSync(join(ROOT, "test", "integration"))) {
      if (f === "util.ts") continue;
      const text = readFileSync(join(ROOT, "test", "integration", f), "utf8");
      expect(text, `${f} reads workspaceFolders directly`).not.toContain("workspaceFolders");
      expect(text, `${f} builds a fixtures path`).not.toMatch(/["']fixtures["']/);
    }
  });
});
