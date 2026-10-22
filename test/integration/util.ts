import * as assert from "node:assert";
import * as path from "node:path";
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

/** Repository fixtures folder; tests must never open files from here directly. */
const REPO_FIXTURES = path.resolve(__dirname, "..", "..", "..", "test", "fixtures");

/** Path of a fixture inside the workspace, which is a temp copy of test/fixtures (see test/isolation.mjs). */
export function fixturePath(...segments: string[]): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "workspace folder missing");
  const ws = path.resolve(folder.uri.fsPath);
  assert.notStrictEqual(ws, REPO_FIXTURES, `workspace must be a temp copy of the fixtures, not ${REPO_FIXTURES}`);
  assert.ok(!ws.startsWith(REPO_FIXTURES + path.sep), `workspace ${ws} is inside the repository fixtures`);
  return path.join(ws, ...segments);
}

/** Opens a fixture from the temp workspace copy in an editor. */
export async function openFixture(name: string): Promise<{ doc: vscode.TextDocument; editor: vscode.TextEditor }> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath("hdlbits", name)));
  const editor = await vscode.window.showTextDocument(doc);
  return { doc, editor };
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
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

