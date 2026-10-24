// worker_threads entry (bundled to dist/yosysWorker.mjs as ESM because
// @yowasp/yosys is ESM-only and finds its wasm through import.meta.url).
import { parentPort } from "node:worker_threads";
import v8 from "node:v8";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

// The 0.70 yosys wasm uses the exnref exception-handling proposal. Electron 43
// (VS Code 1.143) has it on by default; older Node needs the flag. Setting it
// again when already enabled is harmless.
try {
  v8.setFlagsFromString("--experimental-wasm-exnref");
} catch {
  // ignore
}

type Tree = { [name: string]: Tree | string | Uint8Array };
type FetchProgress = { source: { argv0: string }; totalLength: number; doneLength: number };
type RunOptions = {
  stdout?: (b: Uint8Array | null) => void;
  stderr?: (b: Uint8Array | null) => void;
  decodeASCII?: boolean;
  fetchProgress?: (p: FetchProgress) => void;
};
type YosysModule = {
  runYosys: (args?: string[], files?: Tree, options?: RunOptions) => Promise<Tree>;
  version: string;
};

let yosysModule: Promise<YosysModule> | undefined;
let runs = 0;
const decoder = new TextDecoder();

function loadYosys(): Promise<YosysModule> {
  yosysModule ??= import("@yowasp/yosys") as unknown as Promise<YosysModule>;
  return yosysModule;
}

function reply(msg: WorkerResponse): void {
  parentPort?.postMessage(msg);
}

async function handle(req: WorkerRequest): Promise<void> {
  try {
    if (req.kind === "preload") {
      const t0 = performance.now();
      const y = await loadYosys();
      // The runtime reads its wasm and resource tar from the files next to this bundle (file: URLs
      // go through fs, never the network). Its default progress line says "fetched"; say what happens.
      let lastStep = -1;
      await y.runYosys(
        undefined,
        {},
        {
          fetchProgress: (p) => {
            const percent = p.totalLength > 0 ? Math.round((100 * p.doneLength) / p.totalLength) : 100;
            const step = Math.floor(percent / 25);
            if (step === lastStep) return;
            lastStep = step;
            console.log(
              `built-in yosys: loading bundled files from disk, ${percent}% of ${p.totalLength} bytes`,
            );
          },
        },
      );
      reply({ id: req.id, kind: "preload", ok: true, elapsedMs: performance.now() - t0 });
      return;
    }
    if (req.kind === "version") {
      const y = await loadYosys();
      let text = "";
      await y
        .runYosys(
          ["-V"],
          {},
          {
            stdout: (b) => {
              if (b) text += decoder.decode(b);
            },
            decodeASCII: false,
          },
        )
        .catch(() => undefined);
      reply({ id: req.id, kind: "version", ok: true, version: text.trim() || y.version });
      return;
    }
    const y = await loadYosys();
    let stdout = "";
    let stderr = "";
    const t0 = performance.now();
    let ok = true;
    let outFiles: Tree = {};
    try {
      outFiles = await y.runYosys(
        req.args,
        { ...req.files },
        {
          stdout: (b) => {
            if (b) stdout += decoder.decode(b);
          },
          stderr: (b) => {
            if (b) stderr += decoder.decode(b);
          },
          decodeASCII: false,
        },
      );
    } catch (e) {
      ok = false;
      const err = e as { code?: number; files?: Tree; message?: string };
      if (err.files) outFiles = err.files;
      if (!stderr && err.message) stderr = err.message;
    }
    runs++;
    const raw = outFiles[req.outputFile];
    const output =
      raw === undefined
        ? undefined
        : raw instanceof Uint8Array
          ? decoder.decode(raw)
          : typeof raw === "string"
            ? raw
            : undefined;
    reply({
      id: req.id,
      kind: "run",
      ok: ok && output !== undefined,
      ...(output !== undefined ? { output } : {}),
      stdout,
      stderr,
      elapsedMs: performance.now() - t0,
      rssBytes: process.memoryUsage().rss,
      runs,
    });
  } catch (e) {
    reply({
      id: req.id,
      kind: "error",
      ok: false,
      message: e instanceof Error ? (e.stack ?? e.message) : String(e),
    });
  }
}

parentPort?.on("message", (req: WorkerRequest) => {
  void handle(req);
});
