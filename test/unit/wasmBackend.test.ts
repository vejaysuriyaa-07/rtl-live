import { afterAll, describe, expect, it } from "vitest";
import { WasmYosysBackend } from "../../src/synth/wasmBackend";
import { WORKER_PATH } from "./synthHelpers";

const SCRIPT = "read_verilog -sv input.v\nhierarchy -top t\nproc\nwrite_json out.json\n";
const FILES = { "input.v": "module t(input a, output y); assign y = ~a; endmodule\n", "script.ys": SCRIPT };

function req(signal = new AbortController().signal, timeoutMs = 20_000) {
  return { files: FILES, scriptFile: "script.ys", outputFile: "out.json", timeoutMs, signal };
}

const backends: WasmYosysBackend[] = [];
afterAll(() => backends.forEach((b) => b.dispose()));

describe("wasm yosys backend", () => {
  it("recycles the worker every N runs and all runs still succeed (N=3, 7 runs)", async () => {
    const logs: string[] = [];
    const b = new WasmYosysBackend({ workerPath: WORKER_PATH, recycleAfterRuns: 3, log: (m) => logs.push(m) });
    backends.push(b);
    await b.preload();
    for (let i = 0; i < 7; i++) {
      const r = await b.run(req());
      expect(r.ok, `run ${i}: ${r.stderr}`).toBe(true);
      expect(r.output).toContain('"modules"');
    }
    expect(b.stats.recycles).toBeGreaterThanOrEqual(2);
    expect(b.stats.spawns).toBeGreaterThanOrEqual(3);
    expect(logs.some((l) => l.includes("recycling"))).toBe(true);
  }, 120_000);

  it("cancellation kills the run and the next run works", async () => {
    const b = new WasmYosysBackend({ workerPath: WORKER_PATH });
    backends.push(b);
    await b.preload();
    const ac = new AbortController();
    const p = b.run(req(ac.signal));
    ac.abort();
    const r = await p;
    expect(r.cancelled).toBe(true);
    expect(r.ok).toBe(false);
    const r2 = await b.run(req());
    expect(r2.ok).toBe(true);
    expect(b.stats.cancels).toBe(1);
  }, 120_000);

  it("timeout recycles the worker and reports timedOut", async () => {
    const b = new WasmYosysBackend({ workerPath: WORKER_PATH });
    backends.push(b);
    // No preload: the first run must load the wasm, which takes longer than 1 ms.
    const r = await b.run(req(undefined, 1));
    expect(r.timedOut).toBe(true);
    expect(b.stats.timeouts).toBe(1);
    const r2 = await b.run(req());
    expect(r2.ok).toBe(true);
  }, 120_000);

  it("reports a yosys error for broken input", async () => {
    const b = new WasmYosysBackend({ workerPath: WORKER_PATH });
    backends.push(b);
    const r = await b.run({ ...req(), files: { ...FILES, "input.v": "module t(input a, output y); assign y = ; endmodule" } });
    expect(r.ok).toBe(false);
    expect(`${r.stderr}${r.stdout}`).toMatch(/ERROR|syntax error/i);
  }, 120_000);
});
