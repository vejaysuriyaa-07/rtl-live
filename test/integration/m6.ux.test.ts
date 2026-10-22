import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { getApi } from "./util";

async function openFixture(name: string): Promise<{ doc: vscode.TextDocument; editor: vscode.TextEditor }> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "workspace folder missing");
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(folder.uri.fsPath, "hdlbits", name)));
  const editor = await vscode.window.showTextDocument(doc);
  return { doc, editor };
}

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

suite("M6 UX", () => {
  test("cursor on the assign in notgate.v highlights the NOT gate", async function () {
    this.timeout(120_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await api.whenReady();
    const { doc, editor } = await openFixture("notgate.v");
    await api.nextRender((e) => e.doc.sourceUri === doc.uri.toString() && e.doc.fidelity === "synthesized", 90_000);
    // Give the webview a moment to lay out the synthesized diagram.
    await new Promise((r) => setTimeout(r, 500));
    const assignLine = doc.getText().split("\n").findIndex((l) => l.includes("assign out = ~in"));
    assert.ok(assignLine >= 0);
    editor.selection = new vscode.Selection(assignLine, 17, assignLine, 17);
    const ids = await waitFor("highlight of the NOT gate", 10_000, () => {
      const h = api.provider.lastHighlighted;
      return h.some((id) => id.startsWith("gate:not")) ? h : undefined;
    });
    console.log(`highlighted: ${ids.join(", ")}`);
    assert.ok(ids.some((id) => id.startsWith("gate:not")));
    // Moving to line 1 (the header) highlights ports, not the gate.
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await waitFor("highlight cleared from the gate", 10_000, () => (api.provider.lastHighlighted.some((id) => id.startsWith("gate:not")) ? undefined : true));
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });

  test("revealSource from the webview moves the editor selection", async function () {
    this.timeout(60_000);
    const api = await getApi();
    const { doc, editor } = await openFixture("7458.v");
    await api.nextRender((e) => e.doc.sourceUri === doc.uri.toString(), 30_000).catch(() => undefined);
    api.provider.simulateWebviewMessage({ type: "revealSource", generation: 0, line: 9, column: 16, endLine: 9, endColumn: 23 });
    await waitFor("selection to move", 5000, () => (editor.selection.start.line === 8 && editor.selection.start.character === 15 ? true : undefined));
    assert.strictEqual(editor.selection.end.line, 8);
    assert.strictEqual(editor.selection.end.character, 22);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });

  test("deleting endmodule keeps the diagram with a stale badge and banner; undo clears it", async function () {
    this.timeout(120_000);
    const api = await getApi();
    const { doc, editor } = await openFixture("7458.v");
    const good = await api.nextRender((e) => e.doc.sourceUri === doc.uri.toString() && e.doc.fidelity === "synthesized", 90_000);
    const goodNodes = good.doc.modules["top_module"]!.nodes.length;
    assert.ok(goodNodes >= 6);
    const endLine = doc.getText().split("\n").findIndex((l) => l.startsWith("endmodule"));
    await editor.edit((b) => b.delete(new vscode.Range(endLine, 0, endLine, "endmodule".length)));
    await waitFor("stale status", 10_000, () => (api.controller.currentStatus.fidelity === "stale" ? true : undefined));
    // The last render message still carries the synthesized diagram.
    const last = api.provider.lastRenderMessage;
    assert.ok(last && last.type === "render");
    assert.strictEqual(last.doc.fidelity, "synthesized");
    assert.strictEqual(last.doc.modules["top_module"]!.nodes.length, goodNodes);
    await vscode.commands.executeCommand("undo");
    await waitFor("synthesized again", 60_000, () => (api.controller.currentStatus.fidelity === "synthesized" ? true : undefined));
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });
});
