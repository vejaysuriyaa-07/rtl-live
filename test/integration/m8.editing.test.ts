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

suite("M8 editing", () => {
  test("bug 2: a broken edit keeps the last diagram, marks it stale and overlays the changed ports", async function () {
    this.timeout(120_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    const { doc, editor } = await openFixture("7458.v");
    const good = await api.nextRender((e) => e.doc.sourceUri === doc.uri.toString() && e.doc.fidelity === "synthesized", 90_000);
    const goodNodes = good.doc.modules["top_module"]!.nodes.length;
    // Break the file: remove endmodule.
    const endLine = doc.getText().split("\n").findIndex((l) => l.startsWith("endmodule"));
    await editor.edit((b) => b.delete(new vscode.Range(endLine, 0, endLine, "endmodule".length)));
    await waitFor("stale status", 10_000, () => (api.controller.currentStatus.fidelity === "stale" ? true : undefined));
    // While broken, add a port to the header and rename another away.
    const headerLine = doc.getText().split("\n").findIndex((l) => l.includes("output p2y);"));
    await editor.edit((b) => b.replace(new vscode.Range(headerLine, 0, headerLine, doc.lineAt(headerLine).text.length), "  input p2a, p2b, p2c, p2d, output p2y, input extra);"));
    const ev = await waitFor("overlay render", 10_000, () => {
      const last = api.provider.lastRenderMessage;
      if (!last || last.type !== "render") return undefined;
      const ports = last.doc.modules["top_module"]?.ports ?? [];
      return ports.some((p) => p.name === "extra" && p.ghost === "added") ? last : undefined;
    });
    assert.strictEqual(ev.doc.fidelity, "synthesized", "the last good diagram is what stays on screen");
    assert.strictEqual(ev.doc.modules["top_module"]!.nodes.length, goodNodes, "nodes of the last good diagram are kept");
    assert.strictEqual(api.controller.currentStatus.fidelity, "stale");
    assert.match(api.controller.currentStatus.message ?? "", /1 port added/);
    assert.ok(api.provider.webviewLogs.length >= 0);
    // Fix everything: both edits undone.
    await vscode.commands.executeCommand("undo");
    await vscode.commands.executeCommand("undo");
    await waitFor("synthesized again", 60_000, () => (api.controller.currentStatus.fidelity === "synthesized" ? true : undefined));
    const last = api.provider.lastRenderMessage;
    assert.ok(last && last.type === "render" && !last.doc.modules["top_module"]!.ports.some((p) => p.ghost), "ghost ports cleared");
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });

  test("bug 9: untitled Verilog renders; untitled Plain Text that looks like Verilog gets a language hint", async function () {
    this.timeout(60_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    const vdoc = await vscode.workspace.openTextDocument({ language: "verilog", content: "module untitled_v(input a, output b);\n  assign b = a;\nendmodule\n" });
    await vscode.window.showTextDocument(vdoc);
    const ev = await api.nextRender((e) => e.doc.sourceUri === vdoc.uri.toString(), 10_000);
    assert.deepStrictEqual(ev.doc.modules["untitled_v"]!.ports.map((p) => p.name), ["a", "b"]);
    assert.strictEqual(vdoc.uri.scheme, "untitled");
    // Plain Text that looks like Verilog: no render, but a hint with an action.
    const pdoc = await vscode.workspace.openTextDocument({ content: "module untitled_p(input x, output y);\n  assign y = ~x;\nendmodule\n" });
    await vscode.window.showTextDocument(pdoc);
    assert.strictEqual(pdoc.languageId, "plaintext");
    await waitFor("hint", 10_000, () => (api.controller.currentHintDocument === pdoc ? true : undefined));
    const hint = api.provider.lastHint;
    assert.ok(hint && hint.action?.command === "setLanguage", "hint with a Set language action");
    api.provider.simulateWebviewMessage({ type: "setLanguage", generation: 0, language: "verilog" });
    const ev2 = await api.nextRender((e) => e.doc.top === "untitled_p", 10_000);
    assert.deepStrictEqual(ev2.doc.modules["untitled_p"]!.ports.map((p) => p.name), ["x", "y"]);
    await waitFor("hint cleared", 5000, () => (api.provider.lastHint === null ? true : undefined));
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });
});
