// Functional equivalence (accuracy level L1): simulate the original source and
// the netlist exported from the diagram on the same random vectors with
// Icarus Verilog and compare every output bit. Clocked designs are driven
// cycle by cycle on the clock input(s) found through the flip-flop CLK pins.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModuleView, SchematicDoc } from "../../src/ir/types";
import { docToVerilog, ExportError, verilogId } from "../../src/ir/toVerilog";
import { collectStubs, type Stub } from "../../src/synth/blackboxStubs";
import type { StructuralFile } from "../../src/structural/types";

export interface EquivalenceResult {
  ok: boolean;
  /** Why the check could not run or failed */
  reason?: string;
  vectors: number;
  /** Bits skipped because one side was x or z */
  maskedBits: number;
  mismatches: number;
  firstMismatch?: { vector: number; output: string; expected: string; actual: string };
  clocks: string[];
  netlist?: string;
}

export const IVERILOG = "/opt/homebrew/bin/iverilog";
export const VVP = "/opt/homebrew/bin/vvp";

export function icarusAvailable(): boolean {
  return existsSync(IVERILOG) && existsSync(VVP);
}

/** Deterministic PRNG (mulberry32) so a failure reproduces. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function randomBits(next: () => number, width: number): string {
  let out = "";
  for (let i = 0; i < width; i++) out += next() < 0.5 ? "0" : "1";
  return out;
}

/**
 * Behavioral stand-ins for modules the file instantiates but does not define
 * (HDLBits' mod_a, my_dff, add16). The same text is compiled on both sides, so
 * only the logic around the instances is compared. Outputs are a deterministic
 * mix of all inputs, different per output.
 */
export function behavioralStubs(stubs: Stub[]): string {
  const out: string[] = [];
  for (const s of stubs) {
    const ports = s.ports.map((p) => `${p.direction === "inout" ? "input" : p.direction}${p.width > 1 ? ` [${p.width - 1}:0]` : ""} ${verilogId(p.name)}`);
    out.push(`module ${verilogId(s.moduleType)}(${ports.join(", ")});`);
    const ins = s.ports.filter((p) => p.direction !== "output");
    const total = Math.max(1, ins.reduce((a, p) => a + p.width, 0));
    out.push(`  wire [${total - 1}:0] all_in = ${ins.length > 0 ? `{${ins.map((p) => verilogId(p.name)).join(", ")}}` : "1'b0"};`);
    s.ports
      .filter((p) => p.direction === "output")
      .forEach((p, k) => {
        out.push(`  assign ${verilogId(p.name)} = (all_in >> ${k}) ^ (all_in << ${k + 1}) ^ {${p.width}{^all_in}};`);
      });
    out.push("endmodule");
  }
  return out.length > 0 ? `${out.join("\n")}\n` : "";
}

/** Input ports that feed a flip-flop clock pin, directly or through buffers (by net name). */
export function clockInputs(view: ModuleView): string[] {
  const clocks = new Set<string>();
  const netById = new Map(view.nets.map((n) => [n.id, n]));
  for (const n of view.nodes) {
    if (n.kind !== "dff" && n.kind !== "instance" && n.kind !== "blackbox") continue;
    for (const p of n.pins) {
      const isClk = n.kind === "dff" ? p.id === "CLK" : /^clk|clock$/i.test(p.id);
      if (!isClk || !p.net) continue;
      const net = netById.get(p.net);
      if (net?.driver?.node.startsWith("port:")) clocks.add(net.driver.pin);
    }
  }
  return [...clocks].filter((c) => view.ports.some((p) => p.name === c && p.direction === "input"));
}

export interface TestbenchOptions {
  top: string;
  view: ModuleView;
  clocks: string[];
  vectors: number;
  seed: number;
}

export function buildTestbench(o: TestbenchOptions): { text: string; vectors: number } {
  const next = rng(o.seed);
  const inputs = o.view.ports.filter((p) => p.direction === "input");
  const outputs = o.view.ports.filter((p) => p.direction === "output");
  const data = inputs.filter((p) => !o.clocks.includes(p.name));
  const l: string[] = ["`timescale 1ns/1ps", "module tb;"];
  for (const p of inputs) l.push(`  reg ${p.width > 1 ? `[${p.width - 1}:0] ` : ""}${verilogId(p.name)};`);
  for (const p of outputs) l.push(`  wire ${p.width > 1 ? `[${p.width - 1}:0] ` : ""}${verilogId(p.name)};`);
  const conns = [...inputs, ...outputs].map((p) => `.${verilogId(p.name)}(${verilogId(p.name)})`);
  l.push(`  ${verilogId(o.top)} dut(${conns.join(", ")});`);
  const fmt = outputs.map(() => "%b").join(" ");
  const args = outputs.map((p) => verilogId(p.name)).join(", ");
  const show = outputs.length > 0 ? `$display("${fmt}", ${args});` : `$display("");`;
  l.push("  initial begin");
  for (const c of o.clocks) l.push(`    ${verilogId(c)} = 0;`);
  for (let v = 0; v < o.vectors; v++) {
    for (const p of data) l.push(`    ${verilogId(p.name)} = ${p.width}'b${randomBits(next, p.width)};`);
    if (o.clocks.length === 0) {
      l.push(`    #1; ${show}`);
    } else {
      // Settle, sample before the edge, clock, sample after the edge.
      l.push(`    #1; ${show}`);
      for (const c of o.clocks) l.push(`    ${verilogId(c)} = 1;`);
      l.push(`    #1; ${show}`);
      for (const c of o.clocks) l.push(`    ${verilogId(c)} = 0;`);
      l.push("    #1;");
    }
  }
  l.push("    $finish;");
  l.push("  end");
  l.push("endmodule");
  return { text: `${l.join("\n")}\n`, vectors: o.vectors };
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
}

export function simulate(dir: string, name: string, sources: string[]): string[] {
  const out = join(dir, `${name}.vvp`);
  run(IVERILOG, ["-g2012", "-o", out, ...sources], dir);
  const text = run(VVP, ["-n", out], dir);
  return text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("VCD") && !/\$finish/.test(line))
    .map((line) => line.trim())
    .filter((line) => line.length > 0 || true);
}

interface Compared {
  masked: number;
  mismatches: number;
  first?: { vector: number; output: string; expected: string; actual: string };
}

export function compareOutputs(expected: string[], actual: string[], outputNames: string[]): Compared {
  const res: Compared = { masked: 0, mismatches: 0 };
  const n = Math.min(expected.length, actual.length);
  for (let v = 0; v < n; v++) {
    const e = expected[v]!.split(/\s+/);
    const a = actual[v]!.split(/\s+/);
    for (let k = 0; k < Math.max(e.length, a.length); k++) {
      const ev = e[k] ?? "";
      const av = a[k] ?? "";
      if (ev.length !== av.length) {
        res.mismatches++;
        res.first ??= { vector: v, output: outputNames[k] ?? `#${k}`, expected: ev, actual: av };
        continue;
      }
      let bad = false;
      for (let i = 0; i < ev.length; i++) {
        const eb = ev[i]!;
        const ab = av[i]!;
        if (eb === "x" || eb === "z" || ab === "x" || ab === "z") {
          res.masked++;
          continue;
        }
        if (eb !== ab) bad = true;
      }
      if (bad) {
        res.mismatches++;
        res.first ??= { vector: v, output: outputNames[k] ?? `#${k}`, expected: ev, actual: av };
      }
    }
  }
  if (expected.length !== actual.length) {
    res.mismatches++;
    res.first ??= { vector: n, output: "(line count)", expected: String(expected.length), actual: String(actual.length) };
  }
  return res;
}

export interface CheckOptions {
  name: string;
  source: string;
  file: StructuralFile;
  doc: SchematicDoc;
  vectors?: number;
  keepDir?: boolean;
}

/** L1 for one document: export, simulate both, compare. Never throws; failures are reasons. */
export function checkEquivalence(o: CheckOptions): EquivalenceResult {
  const base: EquivalenceResult = { ok: false, vectors: 0, maskedBits: 0, mismatches: 0, clocks: [] };
  if (!icarusAvailable()) return { ...base, reason: "iverilog not installed" };
  const view = o.doc.modules[o.doc.top];
  if (!view) return { ...base, reason: `top module ${o.doc.top} missing` };
  let netlist: string;
  try {
    netlist = docToVerilog(o.doc, { suffix: "_ir" });
  } catch (e) {
    const msg = e instanceof ExportError ? `not exportable: ${e.message}${e.nodeId ? ` (${e.nodeId})` : ""}` : `export threw: ${e instanceof Error ? e.message : String(e)}`;
    return { ...base, reason: msg };
  }
  const clocks = clockInputs(view);
  const vectors = o.vectors ?? (clocks.length > 0 ? 64 : 128);
  const tbOrig = buildTestbench({ top: view.name, view, clocks, vectors, seed: seedOf(o.name) });
  const tbIr = buildTestbench({ top: `${view.name}_ir`, view, clocks, vectors, seed: seedOf(o.name) });
  const stubs = behavioralStubs(collectStubs(o.file, o.doc.top));
  const dir = mkdtempSync(join(tmpdir(), "rl-eq-"));
  try {
    writeFileSync(join(dir, "orig.v"), o.source);
    writeFileSync(join(dir, "ir.v"), netlist);
    writeFileSync(join(dir, "stubs.v"), stubs);
    writeFileSync(join(dir, "tb_orig.v"), tbOrig.text);
    writeFileSync(join(dir, "tb_ir.v"), tbIr.text);
    let expected: string[];
    let actual: string[];
    try {
      expected = simulate(dir, "orig", ["tb_orig.v", "orig.v", "stubs.v"]);
    } catch (e) {
      return { ...base, clocks, reason: `source does not simulate: ${firstLine(e)}`, netlist };
    }
    try {
      actual = simulate(dir, "ir", ["tb_ir.v", "ir.v", "stubs.v"]);
    } catch (e) {
      return { ...base, clocks, reason: `netlist does not compile: ${firstLine(e)}`, netlist };
    }
    const outputs = view.ports.filter((p) => p.direction === "output").map((p) => p.name);
    const cmp = compareOutputs(expected, actual, outputs);
    const result: EquivalenceResult = { ok: cmp.mismatches === 0, vectors, maskedBits: cmp.masked, mismatches: cmp.mismatches, clocks, netlist };
    if (cmp.first) result.firstMismatch = cmp.first;
    if (cmp.mismatches > 0 && cmp.first) result.reason = `output ${cmp.first.output} differs at vector ${cmp.first.vector}: source ${cmp.first.expected}, diagram ${cmp.first.actual}`;
    return result;
  } finally {
    if (!o.keepDir) rmSync(dir, { recursive: true, force: true });
  }
}

function firstLine(e: unknown): string {
  const err = e as { stderr?: string; stdout?: string; message?: string };
  const text = `${err.stderr ?? ""}\n${err.stdout ?? ""}`.split(/\r?\n/).find((l) => /error/i.test(l)) ?? err.message ?? String(e);
  return text.trim().slice(0, 200);
}
