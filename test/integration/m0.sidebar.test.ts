import * as assert from "node:assert";
import * as vscode from "vscode";
import type { RtlLiveTestApi } from "../../src/extension/extension";

export const EXTENSION_ID = "vejaysuriyaa.rtl-live";

export async function getApi(): Promise<RtlLiveTestApi> {
  const ext = vscode.extensions.getExtension<RtlLiveTestApi>(EXTENSION_ID);
  assert.ok(ext, `extension ${EXTENSION_ID} not found`);
  const api = await ext.activate();
  assert.ok(api, "activate() returned no API");
  return api;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms} ms waiting for ${what}`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

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
