// Webview liveness: a ready watchdog after every page load (retry once, then a
// fallback page with a Reload Window action) and a ping/pong heartbeat while
// the view is visible, which reloads the page when a ping goes unanswered
// (the extension host and the webview can lose each other across sleep).
// Pure and timer-injectable so it is unit tested with fake timers.
export interface LifecycleTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LifecycleOptions {
  /** How long the page may take to post ready before it is reloaded */
  readyTimeoutMs: number;
  /** Interval between pings while ready and visible */
  heartbeatMs: number;
  /** How long a pong may take before the page is reloaded */
  pongTimeoutMs: number;
  timers?: LifecycleTimers;
}

export const DEFAULT_LIFECYCLE: LifecycleOptions = { readyTimeoutMs: 8000, heartbeatMs: 15_000, pongTimeoutMs: 5000 };

export interface LifecycleHooks {
  /** Assign fresh HTML (new nonce); the provider calls htmlSet() afterwards */
  reload(reason: string): void;
  /** Replace the page with the failure page that offers Reload Window */
  showFallback(): void;
  ping(id: number): void;
  isVisible(): boolean;
  log(level: "info" | "warn" | "error", text: string): void;
}

export type LifecycleState = "idle" | "loading" | "ready" | "failed";

export class WebviewLifecycle {
  readonly stats = { readyTimeouts: 0, reloads: 0, pings: 0, pongs: 0, heartbeatMisses: 0, fallbacks: 0, resyncs: 0 };
  state: LifecycleState = "idle";
  private readonly timers: LifecycleTimers;
  private readyTimer: unknown;
  private heartbeatTimer: unknown;
  private pongTimer: unknown;
  private pendingPing: number | undefined;
  private seq = 0;
  private attempt = 0;
  private disposed = false;

  constructor(
    private readonly options: LifecycleOptions,
    private readonly hooks: LifecycleHooks,
  ) {
    this.timers = options.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) };
  }

  /** Call right after webview.html was assigned. */
  htmlSet(): void {
    if (this.disposed) return;
    this.clearAll();
    this.state = "loading";
    this.readyTimer = this.timers.setTimeout(() => this.onReadyTimeout(), this.options.readyTimeoutMs);
  }

  /** The page posted ready. */
  ready(): void {
    if (this.disposed) return;
    this.timers.clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
    this.state = "ready";
    this.attempt = 0;
    this.scheduleHeartbeat();
  }

  pong(id: number): void {
    if (this.pendingPing !== id) return;
    this.stats.pongs++;
    this.pendingPing = undefined;
    this.timers.clearTimeout(this.pongTimer);
    this.pongTimer = undefined;
    this.scheduleHeartbeat();
  }

  /** The view became visible or the window regained focus: check the page now. */
  resync(reason: string): void {
    if (this.disposed || this.state !== "ready" || this.pendingPing !== undefined) return;
    this.stats.resyncs++;
    this.hooks.log("info", `webview resync (${reason})`);
    this.timers.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.sendPing();
  }

  dispose(): void {
    this.disposed = true;
    this.clearAll();
  }

  private clearAll(): void {
    this.timers.clearTimeout(this.readyTimer);
    this.timers.clearTimeout(this.heartbeatTimer);
    this.timers.clearTimeout(this.pongTimer);
    this.readyTimer = this.heartbeatTimer = this.pongTimer = undefined;
    this.pendingPing = undefined;
  }

  private onReadyTimeout(): void {
    this.readyTimer = undefined;
    this.stats.readyTimeouts++;
    if (this.attempt === 0) {
      this.attempt = 1;
      this.stats.reloads++;
      this.hooks.log("warn", `webview did not post ready within ${this.options.readyTimeoutMs} ms; reloading it once`);
      this.hooks.reload("no ready");
      return;
    }
    this.state = "failed";
    this.stats.fallbacks++;
    this.hooks.log("error", "webview did not post ready after a reload; showing the failure page");
    this.hooks.showFallback();
  }

  private scheduleHeartbeat(): void {
    this.timers.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = this.timers.setTimeout(() => {
      this.heartbeatTimer = undefined;
      if (this.state !== "ready") return;
      if (!this.hooks.isVisible()) {
        this.scheduleHeartbeat();
        return;
      }
      this.sendPing();
    }, this.options.heartbeatMs);
  }

  private sendPing(): void {
    const id = ++this.seq;
    this.pendingPing = id;
    this.stats.pings++;
    this.hooks.ping(id);
    this.pongTimer = this.timers.setTimeout(() => {
      this.pongTimer = undefined;
      if (this.pendingPing !== id) return;
      this.pendingPing = undefined;
      this.stats.heartbeatMisses++;
      this.stats.reloads++;
      this.hooks.log("warn", `webview did not answer ping ${id} within ${this.options.pongTimeoutMs} ms; reloading it`);
      this.hooks.reload("no pong");
    }, this.options.pongTimeoutMs);
  }
}
