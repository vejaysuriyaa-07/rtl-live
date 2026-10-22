import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StructuralParser } from "../../src/structural/types";
import { HDLBITS, makeTreeSitterParser, readExpected, readFixture } from "./helpers";
import { SYNTH_FIXTURES_BY_MILESTONE, activeMilestones, disposeTestBackend, runChecks, synthFixture, testBackend, type SynthExpectations } from "./synthHelpers";

let parser: StructuralParser;

beforeAll(async () => {
  parser = await makeTreeSitterParser();
  await testBackend().preload();
});
afterAll(() => disposeTestBackend());

const milestones = activeMilestones();

describe("synthesis expectations", () => {
  for (const m of milestones) {
    for (const name of SYNTH_FIXTURES_BY_MILESTONE[m] ?? []) {
      it(`${m} ${name}`, async () => {
        const expected = readExpected(name);
        const synth = expected?.["synth"] as SynthExpectations | undefined;
        expect(synth, `no synth expectations for ${name}`).toBeDefined();
        const moduleName = synth!.module ?? "top_module";
        const text = readFixture(HDLBITS, name);
        const rtl = await synthFixture(parser, text, name, { view: "rtl" });
        expect(rtl.ok, `rtl synthesis failed: ${rtl.error?.message ?? ""}\n${rtl.stderr}`).toBe(true);
        if (synth!.rtl) runChecks(rtl.doc!, moduleName, synth!.rtl, `${name} rtl`);
        for (const [mod, checks] of Object.entries(synth!.rtlModules ?? {})) runChecks(rtl.doc!, mod, checks, `${name} rtl ${mod}`);
        expect(rtl.doc!.fidelity).toBe("synthesized");
        expect(rtl.doc!.view).toBe("rtl");
        expect(rtl.doc!.top).toBe((expected!["top"] as string | undefined) ?? "top_module");
        if (synth!.raw || synth!.gate || synth!.gateModules) {
          const gate = await synthFixture(parser, text, name, { view: "gate" });
          expect(gate.ok, `gate synthesis failed: ${gate.error?.message ?? ""}\n${gate.stderr}`).toBe(true);
          if (synth!.raw) runChecks(gate.rawDoc!, moduleName, synth!.raw, `${name} raw`);
          if (synth!.gate) runChecks(gate.doc!, moduleName, synth!.gate, `${name} gate`);
          for (const [mod, checks] of Object.entries(synth!.gateModules ?? {})) runChecks(gate.doc!, mod, checks, `${name} gate ${mod}`);
          expect(gate.doc!.view).toBe("gate");
        }
      });
    }
  }
});

describe("replicated groups (bug 7)", () => {
  it("vector5: {5{a,b,c,d,e}} is one join of the group fed to an x5 pin, not 25 wires", async () => {
    const res = await synthFixture(parser, readFixture(HDLBITS, "vector5.v"), "vector5.v");
    expect(res.ok).toBe(true);
    const view = res.doc!.modules["top_module"]!;
    const joins = view.nodes.filter((n) => n.kind === "join");
    const outer = joins.find((j) => j.pins.some((p) => p.label === "x5" && p.width === 5));
    expect(outer, `joins: ${joins.map((j) => j.pins.map((p) => `${p.id}:${p.width}${p.label ? `/${p.label}` : ""}`).join(",")).join(" | ")}`).toBeDefined();
    expect(outer!.width).toBe(25);
    const group = joins.find((j) => j.width === 5 && j.pins.filter((p) => p.direction === "in").length === 5);
    expect(group).toBeDefined();
    // The {5{a}},{5{b}},... operand stays one join with five repeat pins.
    const repeats = joins.find((j) => j.pins.filter((p) => p.label === "x5" && p.width === 1).length === 5);
    expect(repeats).toBeDefined();
    expect(joins.every((j) => j.pins.filter((p) => p.direction === "in").length <= 5)).toBe(true);
  });
});

describe("stable ids", () => {
  it("inserting a comment line at the top changes no node or net ids", async () => {
    for (const name of ["7458.v", "notgate.v", "vectorgates.v", "xnor_misc.v"]) {
      const text = readFixture(HDLBITS, name);
      const a = await synthFixture(parser, text, name);
      const b = await synthFixture(parser, `// a comment line\n\n${text}`, name);
      expect(a.ok && b.ok).toBe(true);
      const ids = (d: typeof a) => ({
        nodes: d.doc!.modules["top_module"]!.nodes.map((n) => n.id).sort(),
        nets: d.doc!.modules["top_module"]!.nets.map((n) => n.id).sort(),
      });
      expect(ids(b)).toEqual(ids(a));
      // but src lines moved by two
      const ga = a.doc!.modules["top_module"]!.nodes.find((n) => n.kind === "gate" || n.kind === "reduce")!;
      const gb = b.doc!.modules["top_module"]!.nodes.find((n) => n.id === ga.id)!;
      expect(gb.src[0]!.line).toBe(ga.src[0]!.line + 2);
    }
  });
  it("never uses yosys auto names", async () => {
    const res = await synthFixture(parser, readFixture(HDLBITS, "7458.v"), "7458.v");
    for (const n of res.doc!.modules["top_module"]!.nodes) {
      expect(n.id).not.toMatch(/\$|input\.v/);
    }
  });
});

describe("opt -fast on and off", () => {
  for (const name of ["mux2_always.v", "module_shift8.v", "dff_async.v", "counter4.v", "shift4.v", "fsm_moore.v", "arith_compare.v"]) {
    it(`${name}: no unknown-cell boxes with optimize on or off`, async () => {
      for (const optimize of [false, true]) {
        const res = await synthFixture(parser, readFixture(HDLBITS, name), name, { optimize });
        expect(res.ok, `${name} optimize=${optimize}: ${res.error?.message ?? ""}`).toBe(true);
        const view = res.doc!.modules["top_module"]!;
        expect(view.nodes.filter((n) => n.kind === "unknown").map((n) => n.label), `${name} optimize=${optimize}`).toEqual([]);
        expect(res.unknownCellTypes).toEqual([]);
        expect(view.nodes.length).toBeGreaterThan(0);
      }
    });
  }
});
