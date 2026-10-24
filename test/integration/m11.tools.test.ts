// v0.5: tool lookup is visible. The "Show Tool Paths" command reports what was found and where,
// a setting that points nowhere is reported as skipped, and the engine in use is named: always,
// even while the built-in engine is still loading. The test does not assume a native Yosys; it
// expects the engine the lookup actually chose (RTL_LIVE_YOSYS=off rehearses a machine without one).
import * as assert from "node:assert";
import * as vscode from "vscode";
import { getApi, withTimeout } from "./util";

type Api = Awaited<ReturnType<typeof getApi>>;

function waitForLine(api: Api, re: RegExp, ms: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = (): void => {
      const hit = api.logLines().find((l) => re.test(l));
      if (hit) {
        resolve(hit);
        return;
      }
      if (Date.now() - t0 > ms) {
        reject(
          new Error(
            `no log line matching ${re} within ${ms} ms; last lines:\n${api.logLines().slice(-15).join("\n")}`,
          ),
        );
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

/** Runs the command and returns the lines of the newest report. */
async function toolReport(api: Api): Promise<string[]> {
  await vscode.commands.executeCommand("rtlLive.showToolPaths");
  const lines = api.logLines();
  const header = lines.filter((l) => l.endsWith("tool paths:")).pop();
  assert.ok(header !== undefined, "tool paths header logged");
  // Lines are "<time> [info]   <text>"; keep the text.
  return lines.slice(lines.lastIndexOf(header) + 1).map((l) => l.replace(/^\S+ \[\w+\]\s+/, ""));
}

const ENGINE_ANY =
  /^synthesis engine: (native yosys .* at \S+|built-in wasm yosys( \S+|, loading)?|not decided yet, looking for yosys|not started|off \(rtlLive\.synthesisBackend\))$/;

suite("M11 tool paths", () => {
  test("Show Tool Paths reports yosys, verilator and the engine; a bogus setting is skipped with a reason", async function () {
    this.timeout(120_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    const config = vscode.workspace.getConfiguration("rtlLive");
    await config.update("yosysPath", "/nowhere/rtl-live-test/yosys", vscode.ConfigurationTarget.Global);
    try {
      // The setting change restarts the lookup; the report has an engine line at every moment of it.
      const early = await toolReport(api);
      const earlyEngine = early.find((l) => l.startsWith("synthesis engine: "));
      assert.ok(
        earlyEngine !== undefined && ENGINE_ANY.test(earlyEngine),
        `engine line while deciding: ${earlyEngine ?? "(none)"}`,
      );

      await waitForLine(api, /skipped \/nowhere\/rtl-live-test\/yosys: not found/, 30_000);
      const decided = await withTimeout(api.whenEngineDecided(), 90_000, "engine decision");
      const report = await toolReport(api);
      const text = report.join("\n");
      assert.ok(
        report.some((l) => /^yosys: (\S+ \(.*\)|not found\. Searched \d+ folders)/.test(l)),
        `yosys line in ${text}`,
      );
      assert.ok(
        report.some((l) => /^verilator: (\S+ \(.*\)|not found\. Searched \d+ folders)/.test(l)),
        `verilator line in ${text}`,
      );
      assert.ok(
        report.some((l) => /^skipped \/nowhere\/rtl-live-test\/yosys: not found/.test(l)),
        `the bogus setting is reported as skipped in ${text}`,
      );
      assert.ok(
        report.some((l) => /^platform: \w+ \w+, PATH has \d+ folders/.test(l)),
        `platform line in ${text}`,
      );

      // The engine follows the lookup: native when a yosys was found, the built-in engine otherwise.
      const found = report.find((l) => /^yosys: \S+ \(/.test(l));
      const engine = report.find((l) => l.startsWith("synthesis engine: "));
      assert.ok(engine !== undefined, `engine line in ${text}`);
      if (found) {
        const path = /^yosys: (\S+) \(/.exec(found)?.[1] ?? "";
        assert.strictEqual(decided, "native", `decision with ${found}`);
        assert.match(
          engine,
          new RegExp(
            `^synthesis engine: native yosys \\S+ at ${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          ),
        );
      } else {
        assert.strictEqual(decided, "wasm", `decision with ${text}`);
        assert.match(engine, /^synthesis engine: built-in wasm yosys \S+$/);
      }
    } finally {
      await config.update("yosysPath", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
