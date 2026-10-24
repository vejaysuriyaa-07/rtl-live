// v0.5: tool lookup is visible. The "Show Tool Paths" command reports what was found and where,
// a setting that points nowhere is reported as skipped, and the engine in use is named.
import * as assert from "node:assert";
import * as vscode from "vscode";
import { getApi, withTimeout } from "./util";

function waitForLine(api: Awaited<ReturnType<typeof getApi>>, re: RegExp, ms: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = (): void => {
      const hit = api.logLines().find((l) => re.test(l));
      if (hit) {
        resolve(hit);
        return;
      }
      if (Date.now() - t0 > ms) {
        reject(new Error(`no log line matching ${re} within ${ms} ms; last lines:\n${api.logLines().slice(-15).join("\n")}`));
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

suite("M11 tool paths", () => {
  test("Show Tool Paths reports yosys, verilator and the engine; a bogus setting is skipped with a reason", async function () {
    this.timeout(90_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    const config = vscode.workspace.getConfiguration("rtlLive");
    await config.update("yosysPath", "/nowhere/rtl-live-test/yosys", vscode.ConfigurationTarget.Global);
    try {
      await waitForLine(api, /skipped \/nowhere\/rtl-live-test\/yosys: not found/, 30_000);
      await waitForLine(api, /synthesis backend: (native yosys .* at |wasm yosys)/, 60_000);
      await vscode.commands.executeCommand("rtlLive.showToolPaths");
      const lines = api.logLines();
      const start = lines.lastIndexOf(lines.filter((l) => l.endsWith("tool paths:")).pop() ?? "");
      assert.ok(start >= 0, "tool paths header logged");
      const report = lines.slice(start + 1);
      assert.ok(report.some((l) => /yosys: (\S+ \(.*\)|not found\. Searched \d+ folders)/.test(l)), `yosys line in ${report.join("\n")}`);
      assert.ok(report.some((l) => /verilator: (\S+ \(.*\)|not found\. Searched \d+ folders)/.test(l)), "verilator line");
      assert.ok(report.some((l) => /skipped \/nowhere\/rtl-live-test\/yosys: not found/.test(l)), "the bogus setting is reported as skipped");
      assert.ok(report.some((l) => /synthesis engine: (native yosys \S+ at \S+|built-in wasm yosys)/.test(l)), "engine line");
      assert.ok(report.some((l) => /platform: \w+ \w+, PATH has \d+ folders/.test(l)), "platform line");
    } finally {
      await config.update("yosysPath", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
