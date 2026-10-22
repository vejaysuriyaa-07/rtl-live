import * as assert from "node:assert";
import * as vscode from "vscode";
import { getApi, openFixture, withTimeout } from "./util";

function waitFor<T>(what: string, ms: number, probe: () => T | undefined): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t0 = Date.now();
    const tick = (): void => {
      const v = probe();
      if (v !== undefined) {
        resolve(v);
        return;
      }
      if (Date.now() - t0 > ms) {
        reject(new Error(`timeout waiting for ${what}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

suite("M9 views", () => {
  test("the toolbar toggle switches between the RTL view and the gate view", async function () {
    this.timeout(120_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    if (api.controller.currentView !== "rtl") api.provider.simulateWebviewMessage({ type: "setView", generation: 0, view: "rtl" });
    const { doc } = await openFixture("en_flop.v");
    const rtl = await api.nextRender((e) => e.doc.sourceUri === doc.uri.toString() && e.doc.fidelity === "synthesized", 90_000);
    assert.strictEqual(rtl.doc.view, "rtl");
    assert.strictEqual(api.controller.currentStatus.view, "rtl");
    const rtlNodes = rtl.doc.modules["top_module"]!.nodes;
    assert.ok(rtlNodes.some((n) => n.kind === "dff" && n.pins.some((p) => p.id === "EN")), "RTL view shows an enable flop");
    assert.ok(!rtlNodes.some((n) => n.kind === "mux"), "RTL view has no mux");
    api.provider.simulateWebviewMessage({ type: "setView", generation: 0, view: "gate" });
    const gate = await waitFor("gate view render", 30_000, () => {
      const e = api.controller.lastRenderEvent;
      return e && e.doc.sourceUri === doc.uri.toString() && e.doc.view === "gate" ? e : undefined;
    });
    assert.strictEqual(api.controller.currentStatus.view, "gate");
    const gateNodes = gate.doc.modules["top_module"]!.nodes;
    assert.ok(gateNodes.some((n) => n.kind === "mux"), "gate view shows the enable as a mux");
    assert.ok(gateNodes.some((n) => n.kind === "dff" && !n.pins.some((p) => p.id === "EN")), "gate view flop has no EN pin");
    api.provider.simulateWebviewMessage({ type: "setView", generation: 0, view: "rtl" });
    await waitFor("back to rtl", 30_000, () => (api.controller.lastRenderEvent?.doc.view === "rtl" ? true : undefined));
    assert.strictEqual(api.controller.currentStatus.message, "cached");
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });
});
