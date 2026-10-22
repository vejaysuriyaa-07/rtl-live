import * as assert from "node:assert";
import * as vscode from "vscode";
import { getApi, withTimeout } from "./util";

suite("M0 sidebar", () => {
  test("opening the view resolves the webview and it posts ready", async () => {
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenResolved(), 10_000, "resolveWebviewView");
    assert.ok(api.provider.resolvedCount >= 1, "resolveWebviewView did not run");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    assert.ok(api.provider.isAnyReady, "webview never posted ready");
  });
});
