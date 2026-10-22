// Runs ELK, preferring a Web Worker built from a Blob URL; falls back to the
// bundled main-thread engine once and logs it.
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkGraphIn, ElkGraphOut } from "./types";

type ElkInstance = { layout(graph: unknown): Promise<unknown>; terminateWorker?: () => void };
type ElkCtor = new (opts?: { workerFactory?: (url?: string) => Worker; workerUrl?: string }) => ElkInstance;

export interface ElkRunnerOptions {
  /** URL of dist/elkWorker.js, reachable under the webview CSP connect-src */
  workerScriptUri?: string | undefined;
  log?: (level: "info" | "warn", text: string) => void;
}

export class ElkRunner {
  private elk: ElkInstance | undefined;
  private initPromise: Promise<ElkInstance> | undefined;
  mode: "worker" | "main" | "none" = "none";

  constructor(private readonly opts: ElkRunnerOptions) {}

  private async init(): Promise<ElkInstance> {
    const Ctor = ELK as unknown as ElkCtor;
    const uri = this.opts.workerScriptUri;
    if (uri && typeof Worker !== "undefined" && typeof fetch === "function") {
      try {
        const res = await fetch(uri);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const blob = new Blob([text], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        const worker = new Worker(blobUrl);
        const elk = new Ctor({ workerFactory: () => worker });
        // Smoke test the worker so a CSP failure falls back instead of hanging.
        await withTimeout(elk.layout({ id: "probe", children: [], edges: [] }), 5000);
        this.mode = "worker";
        return elk;
      } catch (e) {
        this.opts.log?.("warn", `ELK worker unavailable, using main thread: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.mode = "main";
    return new Ctor();
  }

  async layout(graph: ElkGraphIn): Promise<ElkGraphOut> {
    this.initPromise ??= this.init().then((e) => {
      this.elk = e;
      return e;
    });
    const elk = this.elk ?? (await this.initPromise);
    return (await elk.layout(graph)) as ElkGraphOut;
  }

  dispose(): void {
    this.elk?.terminateWorker?.();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
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
