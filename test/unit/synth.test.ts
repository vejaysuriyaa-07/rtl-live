import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StructuralParser } from "../../src/structural/types";
import { HDLBITS, makeTreeSitterParser, readExpected, readFixture } from "./helpers";
import { SYNTH_FIXTURES_BY_MILESTONE, activeMilestones, disposeTestBackend, runChecks, synthFixture, testBackend, type Checks } from "./synthHelpers";

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
        const synth = expected?.["synth"] as { raw?: Checks; simplified?: Checks; module?: string } | undefined;
        expect(synth, `no synth expectations for ${name}`).toBeDefined();
        const res = await synthFixture(parser, readFixture(HDLBITS, name), name);
        expect(res.ok, `synthesis failed: ${res.error?.message ?? ""}\n${res.stderr}`).toBe(true);
        const moduleName = synth!.module ?? "top_module";
        if (synth!.raw) runChecks(res.rawDoc!, moduleName, synth!.raw, `${name} raw`);
        if (synth!.simplified) runChecks(res.doc!, moduleName, synth!.simplified, `${name} simplified`);
        expect(res.doc!.fidelity).toBe("synthesized");
        expect(res.doc!.top).toBe((expected!["top"] as string | undefined) ?? "top_module");
      });
    }
  }
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
