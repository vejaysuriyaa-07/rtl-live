// Optional: run verilator --lint-only for a friendlier message when synthesis fails.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findToolSync, realLookupEnv } from "../synth/toolLookup";

/** First verilator candidate on disk (setting, PATH, common folders), unverified. */
export function findVerilator(configured?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return findToolSync("verilator", configured, realLookupEnv(env));
}

export interface LintMessage {
  message: string;
  line?: number;
  column?: number;
}

/** Returns the first %Error line from verilator, or undefined when clean/unavailable. */
export async function verilatorLint(binary: string, text: string, stubs: string, top: string): Promise<LintMessage | undefined> {
  const dir = await mkdtemp(join(tmpdir(), "rtl-live-lint-"));
  try {
    await writeFile(join(dir, "input.v"), text, "utf8");
    const files = ["input.v"];
    if (stubs) {
      await writeFile(join(dir, "blackboxes.v"), stubs, "utf8");
      files.push("blackboxes.v");
    }
    const out = await new Promise<string>((resolve) => {
      const topArgs = top ? ["--top-module", top] : [];
      execFile(binary, ["--lint-only", "-Wno-fatal", ...topArgs, ...files], { cwd: dir, timeout: 10_000 }, (_err, stdout, stderr) => resolve(`${stderr}\n${stdout}`));
    });
    const line = out.split(/\r?\n/).find((l) => l.startsWith("%Error"));
    if (!line) return undefined;
    const m = /input\.v:(\d+):(\d+):\s*(.*)$/.exec(line);
    if (m) return { message: m[3] ?? line, line: Number(m[1]), column: Number(m[2]) };
    return { message: line.replace(/^%Error[^:]*:\s*/, "") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
