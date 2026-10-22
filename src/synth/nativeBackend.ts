// Native yosys via child_process.spawn. Cancelled by killing the process.
import { spawn, execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { existsSync } from "node:fs";
import type { SynthBackend, SynthRunRequest, SynthRunResult } from "./backend";

const CANDIDATES = ["/opt/homebrew/bin/yosys", "/usr/local/bin/yosys"];

export function findYosys(configured: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (configured && configured.trim() !== "") return configured.trim();
  for (const c of CANDIDATES) if (existsSync(c)) return c;
  for (const dir of (env["PATH"] ?? "").split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, "yosys");
    if (existsSync(p)) return p;
  }
  return undefined;
}

export class NativeYosysBackend implements SynthBackend {
  readonly name = "native" as const;
  private cachedVersion: string | undefined;

  constructor(
    readonly binary: string,
    private readonly log?: (msg: string) => void,
  ) {}

  version(): Promise<string | undefined> {
    if (this.cachedVersion) return Promise.resolve(this.cachedVersion);
    return new Promise((resolve) => {
      execFile(this.binary, ["-V"], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve(undefined);
          return;
        }
        const m = /Yosys\s+(\S+)/.exec(stdout);
        this.cachedVersion = m?.[1] ?? stdout.trim();
        resolve(this.cachedVersion);
      });
    });
  }

  async preload(): Promise<void> {
    const v = await this.version();
    if (v === undefined) throw new Error(`${this.binary} did not answer -V`);
  }

  async run(req: SynthRunRequest): Promise<SynthRunResult> {
    if (req.signal.aborted) return { ok: false, stdout: "", stderr: "cancelled", elapsedMs: 0, cancelled: true };
    const dir = await mkdtemp(join(tmpdir(), "rtl-live-"));
    const t0 = performance.now();
    try {
      for (const [name, content] of Object.entries(req.files)) await writeFile(join(dir, name), content, "utf8");
      const result = await new Promise<SynthRunResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        const child = spawn(this.binary, ["-q", "-s", req.scriptFile], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
        let settled = false;
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, req.timeoutMs);
        const onAbort = (): void => {
          child.kill("SIGKILL");
        };
        req.signal.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        const finish = (r: SynthRunResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          req.signal.removeEventListener("abort", onAbort);
          resolve(r);
        };
        child.on("error", (e) => finish({ ok: false, stdout, stderr: `${stderr}\n${e.message}`, elapsedMs: performance.now() - t0 }));
        child.on("close", (code) => {
          const elapsedMs = performance.now() - t0;
          if (req.signal.aborted) finish({ ok: false, stdout, stderr, elapsedMs, cancelled: true });
          else if (timedOut) finish({ ok: false, stdout, stderr: `yosys timed out after ${req.timeoutMs} ms`, elapsedMs, timedOut: true });
          else finish({ ok: code === 0, stdout, stderr, elapsedMs });
        });
      });
      if (result.ok) {
        try {
          result.output = await readFile(join(dir, req.outputFile), "utf8");
        } catch (e) {
          return { ...result, ok: false, stderr: `${result.stderr}\n${e instanceof Error ? e.message : String(e)}` };
        }
      }
      return result;
    } finally {
      rm(dir, { recursive: true, force: true }).catch((e: unknown) => this.log?.(`temp cleanup failed: ${String(e)}`));
    }
  }

  dispose(): void {
    // nothing persistent
  }
}
