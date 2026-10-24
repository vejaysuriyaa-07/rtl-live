import * as vscode from "vscode";
import { initLog, log } from "./log";
import { SchematicViewProvider } from "./schematicView";
import { Controller, type RenderEvent } from "./controller";

/** API returned from activate() so integration tests can observe the extension. */
export interface RtlLiveTestApi {
  provider: SchematicViewProvider;
  controller: Controller;
  /** Resolves once resolveWebviewView has run at least once. */
  whenResolved(): Promise<void>;
  /** Resolves once a webview has posted "ready". */
  whenReady(): Promise<void>;
  /** Resolves with the next render event matching the predicate (or the next one). */
  nextRender(predicate?: (ev: RenderEvent) => boolean, timeoutMs?: number): Promise<RenderEvent>;
  /** Milliseconds spent inside activate() */
  activationMs: number;
  /** The last few hundred lines of the output channel */
  logLines(): string[];
}

export function activate(context: vscode.ExtensionContext): RtlLiveTestApi {
  const t0 = performance.now();
  const channel = initLog();
  context.subscriptions.push(channel);
  log.info("RTL Live activating");

  const provider = new SchematicViewProvider(context.extensionUri);
  context.subscriptions.push(provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SchematicViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const ctl = new Controller(context, provider);
  context.subscriptions.push(ctl);

  context.subscriptions.push(
    vscode.commands.registerCommand("rtlLive.showLog", () => log.show()),
    vscode.commands.registerCommand("rtlLive.openInPanel", () => provider.openInPanel()),
    vscode.commands.registerCommand("rtlLive.fit", () => provider.post({ type: "fit", generation: 0 })),
    vscode.commands.registerCommand("rtlLive.exportSvg", () => provider.post({ type: "export", generation: 0, format: "svg" })),
    vscode.commands.registerCommand("rtlLive.exportPng", () => provider.post({ type: "export", generation: 0, format: "png" })),
    vscode.commands.registerCommand("rtlLive.selectTop", () => void ctl.selectTopInteractively()),
    vscode.commands.registerCommand("rtlLive.showToolPaths", () => ctl.showToolPaths()),
  );

  const activationMs = performance.now() - t0;
  log.info(`RTL Live activated in ${activationMs.toFixed(1)} ms`);

  return {
    provider,
    controller: ctl,
    activationMs,
    logLines: () => log.recent(),
    whenResolved: () =>
      provider.resolvedCount > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const d = provider.onDidResolve(() => {
              d.dispose();
              resolve();
            });
          }),
    whenReady: () =>
      provider.isAnyReady
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const d = provider.onDidBecomeReady(() => {
              d.dispose();
              resolve();
            });
          }),
    nextRender: (predicate, timeoutMs = 5000) =>
      new Promise<RenderEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
          d.dispose();
          reject(new Error(`no matching render within ${timeoutMs} ms`));
        }, timeoutMs);
        const d = ctl.onDidRender((ev) => {
          if (!predicate || predicate(ev)) {
            clearTimeout(timer);
            d.dispose();
            resolve(ev);
          }
        });
      }),
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
