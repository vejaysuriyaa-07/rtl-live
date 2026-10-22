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

