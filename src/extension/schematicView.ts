// Owns the sidebar WebviewView (and optional editor panel) and the typed
// message channel to it. Everything posted goes through postToWebview so
// generations are attached consistently.
import * as vscode from "vscode";
import { buildFallbackHtml, buildWebviewHtml, makeNonce } from "./webviewHtml";
import { isWebviewToHost, type BannerError, type HintInfo, type HostToWebview, type WebviewToHost } from "../shared/protocol";
import { DEFAULT_LIFECYCLE, WebviewLifecycle, type LifecycleOptions } from "./lifecycle";
import { log } from "./log";

export type WebviewMessageHandler = (msg: WebviewToHost, source: "sidebar" | "panel") => void;

interface Target {
  kind: "sidebar" | "panel";
  webview: vscode.Webview;
  ready: boolean;
  disposables: vscode.Disposable[];
  lifecycle: WebviewLifecycle;
  isVisible: () => boolean;
  /** Set when the failure page replaced the view */
  fallback: boolean;
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
  private readonly visibilityEmitter = new vscode.EventEmitter<boolean>();
  /** Fires when the sidebar view is shown or hidden */
  readonly onDidChangeVisibility = this.visibilityEmitter.event;
  /** Lifecycle timing; tests shorten it before (re)loading the view */
  lifecycleOptions: LifecycleOptions = { ...DEFAULT_LIFECYCLE };
  /** Test hook: this many upcoming page loads get HTML that never posts ready */
  breakHtmlLoads = 0;
  /** Count of render messages actually posted to a webview (tests check replay) */
  postedRenders = 0;
  /**
   * Every posted message gets the next number from this counter. The webview drops anything
   * older than the last message it handled, so the order must be global: scheduler generations
   * are per document, and a fresh file would otherwise lose to a long-edited one.
   */
  private postSeq = 0;

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
    const target = this.makeTarget("sidebar", view.webview, () => view.visible);
    this.sidebar = target;
    this.setup(target, view.webview);
    target.disposables.push(
      view.onDidDispose(() => {
        target.disposables.forEach((d) => d.dispose());
        if (this.sidebar === target) this.sidebar = undefined;
      }),
      view.onDidChangeVisibility(() => {
        log.info(`sidebar webview ${view.visible ? "visible" : "hidden"}`);
        if (view.visible) target.lifecycle.resync("visible");
        this.visibilityEmitter.fire(view.visible);
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
    const target = this.makeTarget("panel", panel.webview, () => panel.visible);
    this.panel = { target, panel };
    this.setup(target, panel.webview);
    target.disposables.push(
      panel.onDidDispose(() => {
        target.disposables.forEach((d) => d.dispose());
        this.panel = undefined;
      }),
    );
  }

  private makeTarget(kind: Target["kind"], webview: vscode.Webview, isVisible: () => boolean): Target {
    const target: Target = { kind, webview, ready: false, disposables: [], isVisible, fallback: false, lifecycle: undefined as unknown as WebviewLifecycle };
    target.lifecycle = this.makeLifecycle(target);
    target.disposables.push(new vscode.Disposable(() => target.lifecycle.dispose()));
    return target;
  }

  private makeLifecycle(target: Target): WebviewLifecycle {
    const webview = target.webview;
    return new WebviewLifecycle(this.lifecycleOptions, {
      reload: (reason) => {
        log.warn(`${target.kind} webview reloading (${reason})`);
        target.ready = false;
        this.setHtml(target, webview);
      },
      showFallback: () => {
        target.ready = false;
        target.fallback = true;
        webview.html = buildFallbackHtml({ cspSource: webview.cspSource, nonce: makeNonce(), reason: "The schematic page did not report ready, even after a reload." });
      },
      ping: (id) => void webview.postMessage({ type: "ping", generation: 0, id }),
      isVisible: target.isVisible,
      log: (level, text) => log[level](`${target.kind} ${text}`),
    });
  }

  /** Test hook: throw the sidebar page away and load it again with the current lifecycle options. */
  reloadSidebar(): void {
    const t = this.sidebar;
    if (!t) throw new Error("no sidebar webview");
    t.lifecycle.dispose();
    t.lifecycle = this.makeLifecycle(t);
    t.ready = false;
    t.fallback = false;
    this.setHtml(t, t.webview);
  }

  /** Window focus or similar: ask every live page to answer now. */
  resync(reason: string): void {
    for (const t of this.targets()) t.lifecycle.resync(reason);
  }

  get lifecycleStats(): WebviewLifecycle["stats"] | undefined {
    return this.sidebar?.lifecycle.stats;
  }

  get sidebarFallbackShown(): boolean {
    return this.sidebar?.fallback ?? false;
  }

  private resourceRoots(): vscode.Uri[] {
    return [vscode.Uri.joinPath(this.extensionUri, "dist"), vscode.Uri.joinPath(this.extensionUri, "media")];
  }

  private setup(target: Target, webview: vscode.Webview): void {
    webview.options = { enableScripts: true, enableCommandUris: ["workbench.action.reloadWindow"], localResourceRoots: this.resourceRoots() };
    this.setHtml(target, webview);
    target.disposables.push(
      webview.onDidReceiveMessage((raw: unknown) => this.dispatch(raw, target, webview)),
    );
  }

  private setHtml(target: Target, webview: vscode.Webview): void {
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
    const html = buildWebviewHtml({
      cspSource: webview.cspSource,
      nonce,
      scriptUri,
      styleUri,
      elkWorkerUri,
    });
    if (this.breakHtmlLoads > 0) {
      this.breakHtmlLoads--;
      // A page that loads but never posts ready (exercises the watchdog).
      webview.html = html.replace(/<script nonce="[^"]*" src="[^"]*"><\/script>/, "");
    } else {
      webview.html = html;
    }
    target.lifecycle.htmlSet();
  }

  /** Test hook: feed a message as if the sidebar webview had posted it. */
  simulateWebviewMessage(raw: unknown): void {
    const t = this.sidebar ?? this.panel?.target;
    if (!t) throw new Error("no webview to simulate on");
    this.dispatch(raw, t, t.webview);
  }

  /** The last error banner posted (null when cleared, undefined when never posted). */
  get lastError(): BannerError | null | undefined {
    const m = this.lastMessages.get("error");
    return m && m.type === "error" ? m.error : undefined;
  }

  /** The last hint posted (null when cleared, undefined when never posted). */
  get lastHint(): HintInfo | null | undefined {
    const m = this.lastMessages.get("hint");
    return m && m.type === "hint" ? m.hint : undefined;
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
          target.fallback = false;
          target.lifecycle.ready();
          log.info(`${target.kind} webview ready, replaying ${this.lastMessages.size} message(s)`);
          // Oldest first, so the page's order check accepts every one of them.
          for (const m of [...this.lastMessages.values()].sort((a, b) => a.generation - b.generation)) {
            if (m.type === "render") this.postedRenders++;
            void webview.postMessage(m);
          }
          this.readyEmitter.fire(target.kind);
          return;
        }
        if (raw.type === "pong") {
          target.lifecycle.pong(raw.id);
          return;
        }
        if (raw.type === "reloadWindow") {
          log.warn("reload window requested from the webview");
          void vscode.commands.executeCommand("workbench.action.reloadWindow");
          return;
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
  post(message: HostToWebview): void {
    const msg: HostToWebview = { ...message, generation: ++this.postSeq };
    // "render" and "status" are replayable state; transient commands are not.
    if (msg.type === "render" || msg.type === "status" || msg.type === "error" || msg.type === "theme" || msg.type === "hint") {
      this.lastMessages.set(msg.type, msg);
    }
    for (const t of this.targets()) {
      if (!t.ready) continue;
      if (msg.type === "render") this.postedRenders++;
      void t.webview.postMessage(msg);
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
    this.visibilityEmitter.dispose();
  }
}
