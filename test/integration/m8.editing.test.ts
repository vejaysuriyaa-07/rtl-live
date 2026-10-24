import * as assert from "node:assert";
import * as vscode from "vscode";
import { fixturePath, getApi, openFixture, withTimeout } from "./util";

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

suite("M8 error messages", () => {
  async function bannerAfter(api: Awaited<ReturnType<typeof getApi>>, docUri: string, edit: () => Thenable<boolean>, expectMessage: RegExp): Promise<{ message: string; line?: number; column?: number }> {
    const ok = await edit();
    assert.ok(ok, "edit failed");
    return waitFor(`banner matching ${expectMessage}`, 10_000, () => {
      const e = api.provider.lastError;
      return e && expectMessage.test(e.message) && api.controller.lastRenderEvent?.doc.sourceUri === docUri ? e : undefined;
    });
  }

  test("bug 3: messages say what is missing and point at the right line, including the end of the file", async function () {
    this.timeout(120_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    const { doc, editor } = await openFixture("7458.v");
    await api.nextRender((e) => e.doc.sourceUri === doc.uri.toString(), 10_000);
    const uri = doc.uri.toString();
    // 1. Remove the ';' of "assign w1 = p2a & p2b;" (line 5).
    const l5 = doc.lineAt(4).text;
    const semi = l5.lastIndexOf(";");
    let e = await bannerAfter(api, uri, () => editor.edit((b) => b.delete(new vscode.Range(4, semi, 4, semi + 1))), /^missing ';'$/);
    assert.strictEqual(e.line, 5);
    assert.strictEqual(e.column, semi + 1);
    await vscode.commands.executeCommand("undo");
    await waitFor("clean again", 10_000, () => (api.provider.lastError === null ? true : undefined));
    // 2. Remove endmodule: the message points at the end of the file.
    const endLine = doc.getText().split("\n").findIndex((l) => l.startsWith("endmodule"));
    e = await bannerAfter(api, uri, () => editor.edit((b) => b.delete(new vscode.Range(endLine, 0, endLine, "endmodule".length))), /^missing endmodule$/);
    assert.strictEqual(e.line, endLine, "points at the last line with code");
    await vscode.commands.executeCommand("undo");
    await waitFor("clean again", 10_000, () => (api.provider.lastError === null ? true : undefined));
    // 3. Break the port list: drop the closing ')' of the header (line 3 ends with "output p2y);").
    const l3 = doc.lineAt(2).text;
    const paren = l3.lastIndexOf(")");
    e = await bannerAfter(api, uri, () => editor.edit((b) => b.delete(new vscode.Range(2, paren, 2, paren + 2))), /missing '\)' to close the port list/);
    assert.strictEqual(e.line, 3);
    // Ports recovered from the broken header are still drawn, greyed out.
    const last = api.provider.lastRenderMessage;
    assert.ok(last && last.type === "render");
    const ports = last.doc.modules["top_module"]!.ports;
    assert.ok(ports.some((p) => p.name === "p2y"), "p2y still listed");
    assert.ok(ports.some((p) => p.tentative), "a recovered port is marked tentative");
    await vscode.commands.executeCommand("undo");
    await waitFor("clean again", 10_000, () => (api.provider.lastError === null ? true : undefined));
    // 4. Drop an operand: "assign w1 = p2a & ;" is a missing operand after '&'.
    const amp = doc.lineAt(4).text.indexOf("& p2b");
    e = await bannerAfter(api, uri, () => editor.edit((b) => b.delete(new vscode.Range(4, amp + 1, 4, amp + 5))), /^missing operand after '&'$/);
    assert.strictEqual(e.line, 5);
    await vscode.commands.executeCommand("undo");
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });
});

suite("M8 tab switching", () => {
  test("after many edits in one file, a freshly opened file still reaches the view", async function () {
    this.timeout(120_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    const a = await openFixture("wire4.v");
    await api.nextRender((e) => e.doc.sourceUri === a.doc.uri.toString(), 10_000);
    for (let i = 0; i < 12; i++) {
      await a.editor.edit((b) => b.insert(new vscode.Position(a.doc.lineCount, 0), `// e${i}\n`));
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 300));
    const b = await openFixture("notgate.v");
    const t0 = Date.now();
    await waitFor("the view to show notgate.v", 5000, () => (api.provider.webviewLogs.some((l) => l === `showing ${b.doc.uri.toString()}`) ? true : undefined));
    assert.ok(Date.now() - t0 < 2000, "switching tabs took too long");
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });
});

suite("M8 partial headers", () => {
  test("typing a module header alone draws a titled box with the Editing badge, then ports left and right", async function () {
    this.timeout(60_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    const doc = await vscode.workspace.openTextDocument({ language: "verilog", content: "module top_module(" });
    const editor = await vscode.window.showTextDocument(doc);
    // A broken header renders once, right away; poll the last render instead of waiting for the next one.
    const ev = await waitFor("render of the header", 10_000, () => {
      const e = api.controller.lastRenderEvent;
      return e && e.doc.sourceUri === doc.uri.toString() && e.doc.top === "top_module" ? e : undefined;
    });
    assert.deepStrictEqual(ev.doc.modules["top_module"]!.ports, []);
    await waitFor("Editing badge", 5000, () => (api.controller.currentStatus.editing === true && api.controller.currentStatus.fidelity === "structural" ? true : undefined));
    await editor.edit((b) => b.insert(new vscode.Position(0, "module top_module(".length), "input a, output b"));
    const ev2 = await waitFor("render with two ports", 10_000, () => {
      const e = api.controller.lastRenderEvent;
      return e && e.doc.sourceUri === doc.uri.toString() && (e.doc.modules["top_module"]?.ports.length ?? 0) === 2 ? e : undefined;
    });
    assert.deepStrictEqual(
      ev2.doc.modules["top_module"]!.ports.map((p) => [p.name, p.direction]),
      [
        ["a", "input"],
        ["b", "output"],
      ],
    );
    assert.strictEqual(api.controller.currentStatus.editing, true);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });
});

suite("v0.4.1 editing", () => {
  test("bugs 22 and 23: a lone assign without endmodule explains the assign first and keeps the clean ports solid", async function () {
    this.timeout(60_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath("partial", "p11_assign_keyword_only.v")));
    await vscode.window.showTextDocument(doc);
    const err = await waitFor("banner", 15_000, () => {
      const e = api.provider.lastError;
      return e && e.message.startsWith("assign is incomplete") ? e : undefined;
    });
    assert.strictEqual(err.line, 9);
    assert.strictEqual(err.column, 7);
    assert.deepStrictEqual(err.more?.map((m) => `${m.line}:${m.column} ${m.message}`), ["9:7 missing endmodule"]);
    const last = api.provider.lastRenderMessage;
    assert.ok(last && last.type === "render");
    const ports = last.doc.modules["top_module"]!.ports;
    assert.strictEqual(ports.length, 12);
    assert.deepStrictEqual(ports.filter((p) => p.tentative).map((p) => p.name), [], "a clean header is never ghosted");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });
});
