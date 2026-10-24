// Root hook for the integration suite (mocha tdd: a top-level teardown runs after every test
// in every file). When a test fails, print the extension's recent log lines, its status and the
// active editor, so the CI log alone shows what the extension was doing. The VS Code logs of
// the throwaway profile are uploaded separately (RTL_LIVE_IT_ROOT in test/isolation.mjs).
import * as vscode from "vscode";
import type { RtlLiveTestApi } from "../../src/extension/extension";
import { EXTENSION_ID } from "./util";

const TAIL = 60;

teardown(function () {
  if (this.currentTest?.state !== "failed") return;
  // A hook that throws aborts the rest of the suite, so this one never does.
  try {
    const ext = vscode.extensions.getExtension<RtlLiveTestApi>(EXTENSION_ID);
    const api = ext?.isActive ? ext.exports : undefined;
    if (!api) {
      console.log(`--- RTL Live after "${this.currentTest.title}": extension not activated ---`);
      return;
    }
    const status = JSON.stringify(api.controller.currentStatus);
    const active = vscode.window.activeTextEditor?.document.fileName ?? "none";
    console.log(`--- RTL Live after "${this.currentTest.title}": status ${status}; active editor ${active} ---`);
    for (const line of api.logLines().slice(-TAIL)) console.log(line);
    console.log("--- end of RTL Live log ---");
  } catch (e) {
    console.log(`--- RTL Live failure log unavailable: ${e instanceof Error ? e.message : String(e)} ---`);
  }
});
