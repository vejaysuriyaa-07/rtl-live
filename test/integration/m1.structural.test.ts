import * as assert from "node:assert";
import * as vscode from "vscode";
import { getApi, openFixture } from "./util";

suite("M1 structural", () => {
  test("editing wire.v renders ports in/out within 500 ms", async () => {
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await api.whenReady();
    const parser = await api.controller.whenParserReady();
    // The bundled web-tree-sitter must load; the regex scanner is only a fallback for broken installs.
    assert.strictEqual(parser.name, "tree-sitter", "structural parser is not tree-sitter (grammar failed to load from the bundle)");

    const { doc, editor } = await openFixture("wire.v");
    // Wait for the initial render of this document.
    await api.nextRender((ev) => ev.doc.sourceUri === doc.uri.toString(), 5000).catch(() => undefined);

    const baseline = api.controller.lastRenderEvent?.generation ?? 0;
    const t0 = Date.now();
    const pending = api.nextRender((ev) => ev.doc.sourceUri === doc.uri.toString() && ev.generation > baseline, 2000);
    const ok = await editor.edit((b) => b.insert(new vscode.Position(doc.lineCount, 0), "\n// edit\n"));
    assert.ok(ok, "edit failed");
    const ev = await pending;
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 500, `render took ${elapsed} ms`);
    const top = ev.doc.modules[ev.doc.top];
    assert.ok(top, "top module missing");
    assert.deepStrictEqual(
      top.ports.map((p) => [p.name, p.direction]),
      [
        ["in", "input"],
        ["out", "output"],
      ],
    );
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });

  test("layout engine runs in a worker under the webview CSP", async () => {
    const api = await getApi();
    const found = api.provider.webviewLogs.find((l) => l.startsWith("layout engine:"));
    const line =
      found ??
      (await new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no layout engine log within 10 s")), 10_000);
        const d = api.provider.onWebviewLog((l) => {
          if (l.startsWith("layout engine:")) {
            clearTimeout(t);
            d.dispose();
            resolve(l);
          }
        });
      }));
    console.log(line);
    assert.strictEqual(line, "layout engine: worker");
  });
});
