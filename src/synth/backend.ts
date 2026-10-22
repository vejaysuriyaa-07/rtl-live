// Common interface for the native and wasm Yosys backends.
export interface SynthFiles {
  [name: string]: string;
}

export interface SynthRunRequest {
  files: SynthFiles;
  scriptFile: string;
  outputFile: string;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface SynthRunResult {
  ok: boolean;
  /** Content of outputFile when ok */
  output?: string;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  /** Set when the run was cancelled through the signal */
  cancelled?: boolean;
  /** Set when the run hit the timeout */
  timedOut?: boolean;
}

export interface SynthBackend {
  readonly name: "native" | "wasm";
  /** Resolve the backend version (e.g. "0.70"); undefined when unavailable */
  version(): Promise<string | undefined>;
  /** Warm up (compile wasm, spawn worker). Resolves when ready. */
  preload(): Promise<void>;
  run(req: SynthRunRequest): Promise<SynthRunResult>;
  dispose(): void;
}

export class SynthCancelled extends Error {
  constructor() {
    super("synthesis cancelled");
  }
}
