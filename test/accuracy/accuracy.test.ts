// Accuracy measurement over every fixture, per view, at three levels:
//   L1 functional: the exported netlist simulates like the source (Icarus)
//   L2 structural: the expected JSON assertions hold
//   L3 readable:   the laid-out drawing passes the layout checks
// Results go to artifacts/accuracy.json (scripts/accuracy-report.mjs renders
// docs/ACCURACY_REPORT.md). Known failures are listed in known-failures.json;
// a new failure or a stale entry fails this test, so the baseline stays honest.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SchematicDoc } from "../../src/ir/types";
import { structuralToIr } from "../../src/structural/toIr";
import { selectTop } from "../../src/structural/topSelect";
import type { StructuralFile, StructuralParser } from "../../src/structural/types";
import { HDLBITS, ROOT, listFixtures, makeTreeSitterParser, readExpected, readFixture } from "../unit/helpers";
import { disposeTestBackend, runChecks, synthFixture, testBackend, type SynthExpectations } from "../unit/synthHelpers";
import { checkEquivalence } from "./equivalence";
import { checkLayout, layoutView, type LayoutReport } from "./layout";

export type ViewName = "structural" | "rtl" | "gate";
export const VIEWS: ViewName[] = ["structural", "rtl", "gate"];

export interface CheckResult {
  ok: boolean;
  reason?: string;
  detail?: Record<string, unknown>;
}

export interface ViewResult {
  L1: CheckResult;
  L2: CheckResult;
  L3: CheckResult;
  layout: Record<string, { ok: boolean; issues: string[] }>;
}

export interface FixtureResult {
  fixture: string;
  synthError?: string;
  views: Partial<Record<ViewName, ViewResult>>;
}

const KNOWN_FILE = join(__dirname, "known-failures.json");
const ARTIFACT = join(ROOT, "artifacts", "accuracy.json");
const UPDATE = process.env["UPDATE_ACCURACY_BASELINE"] === "1";

function tryChecks(fn: () => void): CheckResult {
  try {
    fn();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg.split("\n")[0]!.slice(0, 300) };
  }
}

function structuralChecks(file: StructuralFile, top: string, expected: Record<string, unknown> | undefined): CheckResult {
  if (!expected) return { ok: false, reason: "no expected JSON" };
  return tryChecks(() => {
    const m = file.modules.find((x) => x.name === top);
    expect(m, `module ${top} not parsed`).toBeDefined();
    const ports = m!.ports.map((p) => ({ name: p.name, direction: p.direction, width: p.width }));
    expect(ports).toEqual(expected["ports"]);
    const st = expected["structural"] as Record<string, unknown> | undefined;
    if (st) {
      if (st["assigns"] !== undefined) expect(m!.assigns.length, "assign count").toBe(st["assigns"]);
      if (st["always"] !== undefined) expect(m!.always.length, "always count").toBe(st["always"]);
      if (st["instances"] !== undefined) {
        const inst = m!.instances.map((i) => ({ name: i.name, type: i.moduleType, pins: i.connections.map((c) => c.port ?? `p${c.index}`) }));
        expect(inst).toEqual(st["instances"]);
      }
      if (st["decls"] !== undefined) expect(m!.decls.map((d) => d.name)).toEqual(st["decls"]);
    }
  });
}

function synthChecks(view: "rtl" | "gate", raw: SchematicDoc, doc: SchematicDoc, name: string, expected: Record<string, unknown> | undefined): CheckResult {
  if (!expected) return { ok: false, reason: "no expected JSON" };
  const synth = expected["synth"] as SynthExpectations | undefined;
  if (!synth) return { ok: false, reason: "no synth expectations" };
  const moduleName = synth.module ?? "top_module";
  const checks = view === "rtl" ? synth.rtl : synth.gate;
  const modules = view === "rtl" ? synth.rtlModules : synth.gateModules;
  if (!checks && !modules && !(view === "gate" && synth.raw)) {
    // ACCURACY.md 6.2: the gate view is asserted only where it differs from the RTL view.
    return view === "gate" ? { ok: true, detail: { skipped: "no gate-specific assertions" } } : { ok: false, reason: `no ${view} expectations` };
  }
  return tryChecks(() => {
    if (view === "gate" && synth.raw) runChecks(raw, moduleName, synth.raw, `${name} raw`);
    if (checks) runChecks(doc, moduleName, checks, `${name} ${view}`);
    for (const [mod, c] of Object.entries(modules ?? {})) runChecks(doc, mod, c, `${name} ${view} ${mod}`);
  });
}

async function layoutChecks(doc: SchematicDoc): Promise<{ result: CheckResult; layout: ViewResult["layout"] }> {
  const view = doc.modules[doc.top];
  if (!view) return { result: { ok: false, reason: `top ${doc.top} missing` }, layout: {} };
  let rep: LayoutReport;
  try {
    rep = checkLayout(view, await layoutView(view));
  } catch (e) {
    return { result: { ok: false, reason: `layout threw: ${e instanceof Error ? e.message : String(e)}` }, layout: {} };
  }
  const parts = { labelsInside: rep.labelsInside, noOverlap: rep.noOverlap, busLabels: rep.busLabels, fit: rep.fit, wiresClear: rep.wiresClear, wireSpacing: rep.wireSpacing, labelsClear: rep.labelsClear, junctions: rep.junctions, junctionSpacing: rep.junctionSpacing, crossingClearance: rep.crossingClearance };
  const failing = Object.entries(parts).filter(([, c]) => !c.ok);
  const result: CheckResult = failing.length === 0 ? { ok: true } : { ok: false, reason: failing.map(([k, c]) => `${k}: ${c.issues[0]}${c.issues.length > 1 ? ` (+${c.issues.length - 1})` : ""}`).join("; ") };
  result.detail = { width: rep.width, height: rep.height, fitScale: Number(rep.fitScale.toFixed(2)) };
  return { result, layout: parts };
}

let parser: StructuralParser;
beforeAll(async () => {
  parser = await makeTreeSitterParser();
  await testBackend().preload();
});
afterAll(() => disposeTestBackend());

const results: FixtureResult[] = [];

describe("accuracy", () => {
  for (const name of listFixtures(HDLBITS)) {
    it(name, async () => {
      const text = readFixture(HDLBITS, name);
      const expected = readExpected(name);
      const file = parser.parse(text);
      const top = selectTop({ modules: file.modules });
      const r: FixtureResult = { fixture: name, views: {} };
      results.push(r);
      // Structural view (what the sidebar shows while typing).
      const sdoc = structuralToIr(file, { sourceUri: name, generation: 1, top });
      const sl = await layoutChecks(sdoc);
      const sEq = checkEquivalence({ name, source: text, file, doc: sdoc });
      r.views.structural = {
        L1: sEq.ok ? { ok: true } : { ok: false, reason: sEq.reason ?? "mismatch" },
        L2: structuralChecks(file, top, expected),
        L3: sl.result,
        layout: sl.layout,
      };
      // RTL view and gate view (two Yosys runs).
      for (const view of ["rtl", "gate"] as const) {
        const res = await synthFixture(parser, text, name, { view });
        if (!res.ok || !res.doc || !res.rawDoc) {
          r.synthError = res.error?.message ?? "synthesis failed";
          r.views[view] = { L1: { ok: false, reason: r.synthError }, L2: { ok: false, reason: r.synthError }, L3: { ok: false, reason: r.synthError }, layout: {} };
          continue;
        }
        const eq = checkEquivalence({ name, source: text, file, doc: res.doc });
        const rawEq = checkEquivalence({ name, source: text, file, doc: res.rawDoc });
        const l3 = await layoutChecks(res.doc);
        r.views[view] = {
          L1: eq.ok && rawEq.ok ? { ok: true, detail: { vectors: eq.vectors, maskedBits: eq.maskedBits, clocks: eq.clocks } } : { ok: false, reason: eq.ok ? `raw netlist: ${rawEq.reason}` : (eq.reason ?? "mismatch") },
          L2: synthChecks(view, res.rawDoc, res.doc, name, expected),
          L3: l3.result,
          layout: l3.layout,
        };
      }
    }, 120_000);
  }

  it("matches the known-failure baseline", () => {
    mkdirSync(join(ROOT, "artifacts"), { recursive: true });
    results.sort((a, b) => a.fixture.localeCompare(b.fixture));
    writeFileSync(ARTIFACT, `${JSON.stringify(results, null, 2)}\n`);
    const failing: Record<string, string> = {};
    for (const r of results) {
      for (const [view, vr] of Object.entries(r.views)) {
        for (const level of ["L1", "L2", "L3"] as const) {
          const c = vr[level];
          if (!c.ok) failing[`${r.fixture}|${view}|${level}`] = c.reason ?? "";
        }
      }
    }
    if (UPDATE) {
      writeFileSync(KNOWN_FILE, `${JSON.stringify(failing, null, 2)}\n`);
      return;
    }
    const known = JSON.parse(readFileSync(KNOWN_FILE, "utf8")) as Record<string, string>;
    const unexpected = Object.keys(failing).filter((k) => !(k in known));
    const stale = Object.keys(known).filter((k) => !(k in failing));
    expect(unexpected.map((k) => `${k}: ${failing[k]}`), "new accuracy failures (fix them or add to known-failures.json with a reason)").toEqual([]);
    expect(stale, "known failures that now pass; remove them from known-failures.json").toEqual([]);
  });
});
