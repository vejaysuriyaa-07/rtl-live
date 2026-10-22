// Messages between the extension host and the yosys worker thread.
export type WorkerRequest =
  | { id: number; kind: "preload" }
  | { id: number; kind: "version" }
  | { id: number; kind: "run"; args: string[]; files: Record<string, string>; outputFile: string };

export type WorkerResponse =
  | { id: number; kind: "preload"; ok: true; elapsedMs: number }
  | { id: number; kind: "version"; ok: true; version: string }
  | { id: number; kind: "run"; ok: boolean; output?: string; stdout: string; stderr: string; elapsedMs: number; rssBytes: number; runs: number }
  | { id: number; kind: "error"; ok: false; message: string };
