import * as assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { EXTENSION_ID, getApi, withTimeout } from "./util";

suite("M0 sidebar", () => {
  test("opening the view resolves the webview and it posts ready", async () => {
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenResolved(), 10_000, "resolveWebviewView");
    assert.ok(api.provider.resolvedCount >= 1, "resolveWebviewView did not run");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    assert.ok(api.provider.isAnyReady, "webview never posted ready");
    console.log(`activation: ${api.activationMs.toFixed(1)} ms`);
    assert.ok(api.activationMs < 300, `activation took ${api.activationMs} ms`);
  });

  test("the toolbar icon font ships next to the stylesheet that references it", () => {
    // test:packaged runs this against the unpacked vsix, so a missing .vscodeignore entry fails here.
    const root = vscode.extensions.getExtension(EXTENSION_ID)!.extensionPath;
    const css = readFileSync(join(root, "dist", "webview.css"), "utf8");
    const font = /url\("?\.\/(codicon[^"')]*\.ttf)"?\)/.exec(css)?.[1];
    assert.ok(font, "webview.css references the codicon font");
    assert.ok(existsSync(join(root, "dist", font!)), `dist/${font} is in the extension`);
  });
});
