// Shared synthesis helpers for unit and golden tests: a wasm backend and an
// assertion checker for the "synth" block of test/fixtures/expected/<name>.json.
import { join } from "node:path";
import { expect } from "vitest";
import type { ModuleView, Node, SchematicDoc } from "../../src/ir/types";
import { DEFAULT_SIMPLIFY, type SimplifyOptions } from "../../src/ir/simplify";
import type { SynthBackend } from "../../src/synth/backend";
import { synthesize, type SynthesizeResult } from "../../src/synth/synthesize";
import { WasmYosysBackend } from "../../src/synth/wasmBackend";
import { findYosys, NativeYosysBackend } from "../../src/synth/nativeBackend";
import { selectTop } from "../../src/structural/topSelect";
import type { StructuralParser } from "../../src/structural/types";
import type { SynthView } from "../../src/synth/script";
import { ROOT } from "./helpers";

export const WORKER_PATH = join(ROOT, "dist", "yosysWorker.mjs");

let shared: SynthBackend | undefined;

/** Native yosys if present, else wasm. Shared across a test file. */
export function testBackend(): SynthBackend {
  if (shared) return shared;
  const native = findYosys(undefined);
  shared = native ? new NativeYosysBackend(native) : new WasmYosysBackend({ workerPath: WORKER_PATH });
  return shared;
}

export function disposeTestBackend(): void {
  shared?.dispose();
  shared = undefined;
}

export async function synthFixture(
  parser: StructuralParser,
  text: string,
  name: string,
  opts?: { optimize?: boolean; simplify?: SimplifyOptions; top?: string; view?: SynthView },
): Promise<SynthesizeResult> {
  const file = parser.parse(text);
  const top = opts?.top ?? selectTop({ modules: file.modules });
  return synthesize(testBackend(), {
    view: opts?.view ?? "rtl",
    text,
    file,
    top,
    sourceUri: name,
    generation: 1,
    optimize: opts?.optimize ?? false,
    simplify: opts?.simplify ?? DEFAULT_SIMPLIFY,
    timeoutMs: 20_000,
    signal: new AbortController().signal,
  });
}

// ---- expectation checker

export interface Checks {
  count?: Record<string, number>;
  minCount?: Record<string, number>;
  logicNodes?: number;
  nets?: string[];
  netWidth?: Record<string, number>;
  fanout?: Record<string, number>;
  gateInputs?: Record<string, number[]>;
  splitLabels?: string[];
  joinInputs?: number;
  srcLine?: Record<string, number>;
  nodes?: NodeCheck[];
  noUnknown?: boolean;
  portWidth?: Record<string, number>;
}

export interface NodeCheck {
  kind: string;
  op?: string;
  width?: number;
  label?: string;
  labelContains?: string;
  moduleType?: string;
  drillTarget?: string;
  pins?: { id: string; direction?: string; width?: number; inverted?: boolean; net?: string; side?: string }[];
  info?: Record<string, string>;
  infoContains?: Record<string, string>;
  warnings?: string[];
  /** Labels of the input pins, in order (e.g. mux select values) */
  pinLabels?: string[];
  /** Pin ids that must not exist (e.g. no CLK on a latch) */
  noPins?: string[];
}

const LOGIC_KINDS = new Set(["gate", "reduce", "mux", "pmux", "dff", "arith", "compare", "shift", "unknown"]);

function sel(view: ModuleView, key: string): Node[] {
  const [kind, op] = key.split(":");
  return view.nodes.filter((n) => n.kind === kind && (op === undefined || n.op === op));
}

function netByName(view: ModuleView, name: string) {
  return view.nets.find((n) => n.name === name);
}

function nodeMatches(n: Node, c: NodeCheck): boolean {
  if (n.kind !== c.kind) return false;
  if (c.op !== undefined && n.op !== c.op) return false;
  if (c.width !== undefined && n.width !== c.width) return false;
  if (c.label !== undefined && n.label !== c.label) return false;
  if (c.labelContains !== undefined && !n.label.includes(c.labelContains)) return false;
  if (c.moduleType !== undefined && n.moduleType !== c.moduleType) return false;
  if (c.drillTarget !== undefined && n.drillTarget !== c.drillTarget) return false;
  if (c.warnings !== undefined && JSON.stringify(n.warnings ?? []) !== JSON.stringify(c.warnings)) return false;
  if (c.info !== undefined) for (const [k, v] of Object.entries(c.info)) if (n.info?.[k] !== v) return false;
  if (c.infoContains !== undefined) for (const [k, v] of Object.entries(c.infoContains)) if (!(n.info?.[k] ?? "").includes(v)) return false;
  if (c.pinLabels !== undefined) {
    const labels = n.pins.filter((p) => p.direction === "in" && p.label !== "").map((p) => p.label);
    if (JSON.stringify(labels) !== JSON.stringify(c.pinLabels)) return false;
  }
  if (c.noPins) for (const id of c.noPins) if (n.pins.some((p) => p.id === id)) return false;
  if (c.pins) {
    for (const pc of c.pins) {
      const p = n.pins.find((x) => x.id === pc.id);
      if (!p) return false;
      if (pc.direction !== undefined && p.direction !== pc.direction) return false;
      if (pc.width !== undefined && p.width !== pc.width) return false;
      if (pc.inverted !== undefined && Boolean(p.inverted) !== pc.inverted) return false;
      if (pc.side !== undefined && p.side !== pc.side) return false;
      if (pc.net !== undefined && p.net !== `net:${pc.net}`) return false;
    }
  }
  return true;
}

export function runChecks(doc: SchematicDoc, moduleName: string, checks: Checks, label: string): void {
  const view = doc.modules[moduleName];
  expect(view, `${label}: module ${moduleName} missing`).toBeDefined();
  if (!view) return;
  const summary = (): string => `${label}: nodes=${view.nodes.map((n) => `${n.kind}${n.op ? `:${n.op}` : ""}(${n.width})`).join(" ")}`;
  if (checks.count) for (const [k, v] of Object.entries(checks.count)) expect(sel(view, k).length, `${summary()} count ${k}`).toBe(v);
  if (checks.minCount) for (const [k, v] of Object.entries(checks.minCount)) expect(sel(view, k).length, `${summary()} minCount ${k}`).toBeGreaterThanOrEqual(v);
  if (checks.logicNodes !== undefined) expect(view.nodes.filter((n) => LOGIC_KINDS.has(n.kind)).length, `${summary()} logicNodes`).toBe(checks.logicNodes);
  if (checks.nets) for (const name of checks.nets) expect(netByName(view, name), `${label}: net ${name}`).toBeDefined();
  if (checks.netWidth) for (const [name, w] of Object.entries(checks.netWidth)) expect(netByName(view, name)?.width, `${label}: width of ${name}`).toBe(w);
  if (checks.fanout) for (const [name, k] of Object.entries(checks.fanout)) expect(netByName(view, name)?.sinks.length, `${label}: fanout of ${name}`).toBe(k);
  if (checks.gateInputs) {
    for (const [k, arr] of Object.entries(checks.gateInputs)) {
      const counts = sel(view, k)
        .map((n) => n.pins.filter((p) => p.direction === "in").length)
        .sort((a, b) => a - b);
      expect(counts, `${summary()} gateInputs ${k}`).toEqual(arr);
    }
  }
  if (checks.splitLabels) {
    const labels = view.nodes.filter((n) => n.kind === "split").flatMap((n) => n.pins.filter((p) => p.direction === "out").map((p) => p.bits ?? ""));
    for (const l of checks.splitLabels) expect(labels, `${label}: split labels`).toContain(l);
  }
  if (checks.joinInputs !== undefined) {
    const joins = view.nodes.filter((n) => n.kind === "join");
    const max = Math.max(0, ...joins.map((j) => j.pins.filter((p) => p.direction === "in").length));
    expect(max, `${label}: join inputs`).toBeGreaterThanOrEqual(checks.joinInputs);
  }
  if (checks.srcLine) {
    for (const [k, line] of Object.entries(checks.srcLine)) {
      const n = sel(view, k)[0];
      expect(n?.src[0]?.line, `${label}: src line of ${k}`).toBe(line);
    }
  }
  if (checks.nodes) {
    for (const c of checks.nodes) {
      expect(view.nodes.some((n) => nodeMatches(n, c)), `${summary()} expected node ${JSON.stringify(c)}`).toBe(true);
    }
  }
  if (checks.noUnknown) expect(view.nodes.filter((n) => n.kind === "unknown").map((n) => n.label), `${label}: unknown cells`).toEqual([]);
  if (checks.portWidth) for (const [name, w] of Object.entries(checks.portWidth)) expect(view.ports.find((p) => p.name === name)?.width, `${label}: port ${name}`).toBe(w);
}

/** Milestones whose synthesis expectations and golden files are complete. Bumped per milestone. */
export const COMPLETED_MILESTONES = ["M2", "M3", "M4", "M5", "M8"];

export function activeMilestones(): string[] {
  const env = process.env["SYNTH_MILESTONES"];
  return env ? env.split(",") : COMPLETED_MILESTONES;
}

export const SYNTH_FIXTURES_BY_MILESTONE: Record<string, string[]> = {
  M2: ["wire.v", "wire4.v", "notgate.v", "7458.v", "gates4.v", "xnor_misc.v", "vectorgates.v"],
  M3: ["vector0.v", "vector2.v", "vectorr.v", "vector3.v", "vector4.v", "vector5.v"],
  M4: ["module.v", "module_pos.v", "module_name.v", "module_shift.v", "module_add.v", "module_add_full.v", "multi_module.v"],
  M5: ["mux2_always.v", "module_shift8.v", "dff_async.v", "counter4.v", "shift4.v", "fsm_moore.v", "arith_compare.v"],
  // v0.2: ACCURACY.md 5.2 datapath cases plus the feature variants added in Phase 2
  M8: ["rca4.v", "mux4_case.v", "en_flop.v", "scan_flop.v", "latch_vs_flop.v", "counter8_reset.v", "compare4.v", "bitwise_vs_logical.v", "inverted_gates.v", "case_mux.v", "dff_enable.v", "dff_sync_reset_en.v", "latch_en.v", "logic_ops.v", "ternary.v", "nand_nor.v"],
};

/** The synth block of an expected file: per-view checks plus checks for other modules of the file. */
export interface SynthExpectations {
  module?: string;
  raw?: Checks;
  rtl?: Checks;
  gate?: Checks;
  rtlModules?: Record<string, Checks>;
  gateModules?: Record<string, Checks>;
}
