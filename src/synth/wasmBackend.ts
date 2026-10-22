// @yowasp/yosys in a worker_threads worker. Recycled every N runs, when the
// process RSS exceeds a threshold (wasm memory never shrinks), and on timeout.
import { Worker } from "node:worker_threads";
import type { SynthBackend, SynthRunRequest, SynthRunResult } from "./backend";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

export interface WasmBackendOptions {
  /** Absolute path to dist/yosysWorker.mjs */
  workerPath: string;
  recycleAfterRuns?: number;
  recycleRssBytes?: number;
  log?: (msg: string) => void;
}

interface Pending {
  resolve: (r: WorkerResponse) => void;
  reject: (e: Error) => void;
}

export class WasmYosysBackend implements SynthBackend {
  readonly name = "wasm" as const;
  private worker: Worker | undefined;
  /** In-flight requests per worker, so a terminated worker only fails its own */
  private readonly pendingByWorker = new WeakMap<Worker, Map<number, Pending>>();
  private nextId = 1;
  private runsOnWorker = 0;
  private preloadPromise: Promise<void> | undefined;
  private cachedVersion: string | undefined;
  private disposed = false;
  /** Workers we terminated on purpose; their exit is not an error */
  private readonly terminating = new WeakSet<Worker>();
  readonly recycleAfterRuns: number;
  readonly recycleRssBytes: number;
  /** Counters for tests and the log */
  stats = { spawns: 0, recycles: 0, timeouts: 0, cancels: 0 };

  constructor(private readonly opts: WasmBackendOptions) {
    this.recycleAfterRuns = opts.recycleAfterRuns ?? 50;
    this.recycleRssBytes = opts.recycleRssBytes ?? 1.5 * 1024 * 1024 * 1024;
  }

  private spawn(): Worker {
    const w = new Worker(this.opts.workerPath);
    const pending = new Map<number, Pending>();
    this.pendingByWorker.set(w, pending);
    this.stats.spawns++;
    w.on("message", (msg: WorkerResponse) => {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      p.resolve(msg);
    });
    const fail = (err: Error): void => {
      if (this.worker === w) this.worker = undefined;
      for (const [, p] of pending) p.reject(err);
      pending.clear();
    };
    w.on("error", (e) => {
      this.opts.log?.(`yosys worker error: ${e.message}`);
      fail(e);
    });
    w.on("exit", (code) => {
      if (code !== 0 && !this.terminating.has(w)) this.opts.log?.(`yosys worker exited with code ${code}`);
      fail(new Error(`yosys worker exited (${code})`));
    });
    this.runsOnWorker = 0;
    return w;
  }

  private ensureWorker(): Worker {
    if (this.disposed) throw new Error("backend disposed");
    this.worker ??= this.spawn();
    return this.worker;
  }

  private recycle(reason: string): void {
    this.opts.log?.(`recycling yosys worker: ${reason}`);
    this.stats.recycles++;
    const w = this.worker;
    this.worker = undefined;
    this.preloadPromise = undefined;
    if (w) {
      this.terminating.add(w);
      void w.terminate();
    }
  }

  private request(req: WorkerRequest, worker: Worker): Promise<WorkerResponse> {
    return new Promise<WorkerResponse>((resolve, reject) => {
      const pending = this.pendingByWorker.get(worker);
      if (!pending) {
        reject(new Error("worker gone"));
        return;
      }
      pending.set(req.id, { resolve, reject });
      worker.postMessage(req);
    });
  }

  async version(): Promise<string | undefined> {
    if (this.cachedVersion) return this.cachedVersion;
    try {
      const w = this.ensureWorker();
      const res = await this.request({ id: this.nextId++, kind: "version" }, w);
      if (res.kind === "version") {
        const m = /Yosys\s+(\S+)/.exec(res.version);
        this.cachedVersion = m?.[1] ?? res.version;
      }
    } catch {
      return undefined;
    }
    return this.cachedVersion;
  }

  preload(): Promise<void> {
    this.preloadPromise ??= (async () => {
      const w = this.ensureWorker();
      const res = await this.request({ id: this.nextId++, kind: "preload" }, w);
      if (res.kind === "error") throw new Error(res.message);
      if (res.kind === "preload") this.opts.log?.(`yosys wasm ready in ${res.elapsedMs.toFixed(0)} ms`);
    })();
    return this.preloadPromise;
  }

  async run(req: SynthRunRequest): Promise<SynthRunResult> {
    if (req.signal.aborted) return { ok: false, stdout: "", stderr: "cancelled", elapsedMs: 0, cancelled: true };
    const worker = this.ensureWorker();
    const id = this.nextId++;
    const t0 = performance.now();
    const args = ["-q", "-s", req.scriptFile];
    let timer: NodeJS.Timeout | undefined;
    const onAbort = (): void => {
      this.stats.cancels++;
      this.recycle("cancelled");
    };
    req.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await Promise.race([
        this.request({ id, kind: "run", args, files: req.files, outputFile: req.outputFile }, worker),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), req.timeoutMs);
        }),
      ]);
      if (res === "timeout") {
        this.stats.timeouts++;
        this.pendingByWorker.get(worker)?.delete(id);
        this.recycle(`timeout after ${req.timeoutMs} ms`);
        return { ok: false, stdout: "", stderr: `yosys timed out after ${req.timeoutMs} ms`, elapsedMs: performance.now() - t0, timedOut: true };
      }
      if (res.kind === "error") return { ok: false, stdout: "", stderr: res.message, elapsedMs: performance.now() - t0 };
      if (res.kind !== "run") return { ok: false, stdout: "", stderr: "unexpected worker reply", elapsedMs: performance.now() - t0 };
      this.runsOnWorker++;
      if (this.runsOnWorker >= this.recycleAfterRuns) this.recycle(`${this.runsOnWorker} runs`);
      else if (res.rssBytes > this.recycleRssBytes) this.recycle(`rss ${(res.rssBytes / 1048576).toFixed(0)} MB`);
      return { ok: res.ok, ...(res.output !== undefined ? { output: res.output } : {}), stdout: res.stdout, stderr: res.stderr, elapsedMs: res.elapsedMs };
    } catch (e) {
      if (req.signal.aborted) return { ok: false, stdout: "", stderr: "cancelled", elapsedMs: performance.now() - t0, cancelled: true };
      return { ok: false, stdout: "", stderr: e instanceof Error ? e.message : String(e), elapsedMs: performance.now() - t0 };
    } finally {
      if (timer) clearTimeout(timer);
      req.signal.removeEventListener("abort", onAbort);
    }
  }

  dispose(): void {
    this.disposed = true;
    const w = this.worker;
    this.worker = undefined;
    if (w) {
      this.terminating.add(w);
      void w.terminate();
    }
  }
}
