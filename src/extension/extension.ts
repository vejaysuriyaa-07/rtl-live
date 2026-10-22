import * as vscode from "vscode";
import { initLog, log } from "./log";
import { SchematicViewProvider } from "./schematicView";

/** API returned from activate() so integration tests can observe the extension. */
export interface RtlLiveTestApi {
  provider: SchematicViewProvider;
  /** Resolves once resolveWebviewView has run at least once. */
  whenResolved(): Promise<void>;
  /** Resolves once a webview has posted "ready". */
  whenReady(): Promise<void>;
}

let provider: SchematicViewProvider | undefined;

export function activate(context: vscode.ExtensionContext): RtlLiveTestApi {
  const channel = initLog();
  context.subscriptions.push(channel);
  log.info("RTL Live activating");

  provider = new SchematicViewProvider(context.extensionUri);
  context.subscriptions.push(provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SchematicViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const p = provider;
  context.subscriptions.push(
    vscode.commands.registerCommand("rtlLive.showLog", () => log.show()),
    vscode.commands.registerCommand("rtlLive.openInPanel", () => p.openInPanel()),
    vscode.commands.registerCommand("rtlLive.fit", () => p.post({ type: "fit", generation: 0 })),
    vscode.commands.registerCommand("rtlLive.exportSvg", () => p.post({ type: "export", generation: 0, format: "svg" })),
    vscode.commands.registerCommand("rtlLive.exportPng", () => p.post({ type: "export", generation: 0, format: "png" })),
    vscode.commands.registerCommand("rtlLive.selectTop", () => {
      void vscode.window.showInformationMessage("RTL Live: no modules parsed yet.");
    }),
  );

  log.info("RTL Live activated");

  return {
    provider: p,
    whenResolved: () =>
      p.resolvedCount > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const d = p.onDidResolve(() => {
              d.dispose();
              resolve();
            });
          }),
    whenReady: () =>
      p.isAnyReady
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const d = p.onDidBecomeReady(() => {
              d.dispose();
              resolve();
            });
          }),
  };
}

export function deactivate(): void {
  provider = undefined;
}
