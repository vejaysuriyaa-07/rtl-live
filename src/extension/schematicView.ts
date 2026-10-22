// Owns the sidebar WebviewView (and optional editor panel) and the typed
// message channel to it. Everything posted goes through postToWebview so
// generations are attached consistently.
import * as vscode from "vscode";
import { buildWebviewHtml, makeNonce } from "./webviewHtml";
import { isWebviewToHost, type HostToWebview, type WebviewToHost } from "../shared/protocol";
import { log } from "./log";

export type WebviewMessageHandler = (msg: WebviewToHost, source: "sidebar" | "panel") => void;

interface Target {
  kind: "sidebar" | "panel";
  webview: vscode.Webview;
  ready: boolean;
  disposables: vscode.Disposable[];
}

export class SchematicViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "rtlLive.schematic";

  private sidebar: Target | undefined;
  private panel: { target: Target; panel: vscode.WebviewPanel } | undefined;
  private readonly handlers: WebviewMessageHandler[] = [];
  private readonly resolvedEmitter = new vscode.EventEmitter<void>();
  private readonly readyEmitter = new vscode.EventEmitter<"sidebar" | "panel">();
  /** Last message of each kind, replayed to a webview that becomes ready later */
  private readonly lastMessages = new Map<string, HostToWebview>();

  readonly onDidResolve = this.resolvedEmitter.event;
  readonly onDidBecomeReady = this.readyEmitter.event;
  resolvedCount = 0;
  /** Recent webview log lines (for tests and diagnostics) */
  readonly webviewLogs: string[] = [];
  private readonly logEmitter = new vscode.EventEmitter<string>();
  readonly onWebviewLog = this.logEmitter.event;
  /** Ids the webview last highlighted for the editor cursor */
  lastHighlighted: string[] = [];
  private readonly highlightEmitter = new vscode.EventEmitter<string[]>();
  readonly onDidHighlight = this.highlightEmitter.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  onMessage(handler: WebviewMessageHandler): vscode.Disposable {
    this.handlers.push(handler);
    return new vscode.Disposable(() => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.sidebar?.disposables.forEach((d) => d.dispose());
    const target: Target = { kind: "sidebar", webview: view.webview, ready: false, disposables: [] };
    this.sidebar = target;
    this.setup(target, view.webview);
    target.disposables.push(
      view.onDidDispose(() => {
        target.disposables.forEach((d) => d.dispose());
        if (this.sidebar === target) this.sidebar = undefined;
      }),
    );
    this.resolvedCount++;
    log.info(`sidebar webview resolved (visible: ${view.visible})`);
    this.resolvedEmitter.fire();
  }

  openInPanel(): void {
    if (this.panel) {
      this.panel.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "rtlLive.panel",
      "RTL Live",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: this.resourceRoots() },
    );
    const target: Target = { kind: "panel", webview: panel.webview, ready: false, disposables: [] };
    this.panel = { target, panel };
    this.setup(target, panel.webview);
    target.disposables.push(
      panel.onDidDispose(() => {
        target.disposables.forEach((d) => d.dispose());
        this.panel = undefined;
      }),
    );
  }

  private resourceRoots(): vscode.Uri[] {
    return [vscode.Uri.joinPath(this.extensionUri, "dist"), vscode.Uri.joinPath(this.extensionUri, "media")];
  }

  private setup(target: Target, webview: vscode.Webview): void {
    webview.options = { enableScripts: true, localResourceRoots: this.resourceRoots() };
    const nonce = makeNonce();
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"))
      .toString();
    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css"))
      .toString();
    const elkWorkerUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "elkWorker.js"))
      .toString();
    log.info(`${target.kind} webview script ${scriptUri}`);
    webview.html = buildWebviewHtml({
      cspSource: webview.cspSource,
      nonce,
      scriptUri,
      styleUri,
      elkWorkerUri,
    });
    target.disposables.push(
      webview.onDidReceiveMessage((raw: unknown) => this.dispatch(raw, target, webview)),
    );
  }

  /** Test hook: feed a message as if the sidebar webview had posted it. */
  simulateWebviewMessage(raw: unknown): void {
    const t = this.sidebar ?? this.panel?.target;
    if (!t) throw new Error("no webview to simulate on");
    this.dispatch(raw, t, t.webview);
  }

  /** The last render message posted (or queued for a late webview). */
  get lastRenderMessage(): HostToWebview | undefined {
    return this.lastMessages.get("render");
  }

  private dispatch(raw: unknown, target: Target, webview: vscode.Webview): void {
    {
      {
        if (!isWebviewToHost(raw)) {
          log.warn(`Dropped malformed webview message: ${JSON.stringify(raw).slice(0, 200)}`);
          return;
        }
        if (raw.type === "highlighted") {
          this.lastHighlighted = raw.ids;
          this.highlightEmitter.fire(raw.ids);
          return;
        }
        if (raw.type === "ready") {
          target.ready = true;
          log.info(`${target.kind} webview ready, replaying ${this.lastMessages.size} message(s)`);
          for (const m of this.lastMessages.values()) {
            void webview.postMessage(m);
          }
          this.readyEmitter.fire(target.kind);
        }
        if (raw.type === "log") {
          const text = `[webview] ${raw.text}`;
          this.webviewLogs.push(raw.text);
          if (this.webviewLogs.length > 200) this.webviewLogs.shift();
          this.logEmitter.fire(raw.text);
          if (raw.level === "error") log.error(text);
          else if (raw.level === "warn") log.warn(text);
          else log.info(text);
          return;
        }
        for (const h of this.handlers) {
          try {
            h(raw, target.kind);
          } catch (e) {
            log.error("Webview message handler threw", e);
          }
        }
      }
    }
  }

  /** Post to every live webview; remembers the latest message per type for late-ready webviews. */
  post(msg: HostToWebview): void {
    // "render" and "status" are replayable state; transient commands are not.
    if (msg.type === "render" || msg.type === "status" || msg.type === "error" || msg.type === "theme") {
      this.lastMessages.set(msg.type, msg);
    }
    for (const t of this.targets()) {
      if (t.ready) void t.webview.postMessage(msg);
    }
  }

  private targets(): Target[] {
    const out: Target[] = [];
    if (this.sidebar) out.push(this.sidebar);
    if (this.panel) out.push(this.panel.target);
    return out;
  }

  get isAnyReady(): boolean {
    return this.targets().some((t) => t.ready);
  }

  dispose(): void {
    this.sidebar?.disposables.forEach((d) => d.dispose());
    this.panel?.panel.dispose();
    this.resolvedEmitter.dispose();
    this.readyEmitter.dispose();
    this.logEmitter.dispose();
    this.highlightEmitter.dispose();
  }
}
