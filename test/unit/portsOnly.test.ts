// Bug 21: a module with ports but no logic is drawn as a box, every undriven output marked "not driven yet".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { structuralToIr } from "../../src/structural/toIr";
import type { StructuralParser } from "../../src/structural/types";
import { renderModule } from "../../webview/render/svg";
import { portTooltip } from "../../webview/render/tooltips";
import { layoutView } from "../accuracy/layout";
import { PARTIAL, makeTreeSitterParser, readFixture } from "./helpers";
import { disposeTestBackend, synthFixture, testBackend } from "./synthHelpers";

let parser: StructuralParser;
const NAME = "p10_ports_only.v";
const OUTPUTS = ["out_or_bitwise", "out_or_logical", "out_not"];

beforeAll(async () => {
  parser = await makeTreeSitterParser();
  await testBackend().preload();
});
afterAll(() => disposeTestBackend());

describe("ports-only module", () => {
  it("synthesizes to a module with its five ports and no nodes, outputs undriven", async () => {
    const text = readFixture(PARTIAL, NAME);
    for (const view of ["rtl", "gate"] as const) {
      const res = await synthFixture(parser, text, NAME, { view });
      expect(res.ok, res.error?.message).toBe(true);
      const v = res.doc!.modules["top_module"];
      expect(v, `${view}: top_module missing from the synthesized doc`).toBeDefined();
      expect(v!.ports.map((p) => p.name)).toEqual(["a", "b", ...OUTPUTS]);
      expect(v!.nodes).toEqual([]);
      expect(v!.ports.filter((p) => p.undriven).map((p) => p.name)).toEqual(OUTPUTS);
      expect(v!.ports.find((p) => p.name === "a")!.undriven).toBeUndefined();
    }
  });

  it("the structural view marks the same outputs undriven and a driven output stays plain", () => {
    const file = parser.parse(readFixture(PARTIAL, NAME));
    const doc = structuralToIr(file, { sourceUri: NAME, generation: 1, top: "top_module" });
    expect(doc.modules["top_module"]!.ports.filter((p) => p.undriven).map((p) => p.name)).toEqual(OUTPUTS);
    const driven = parser.parse("module t(input a, output y, output z);\n  assign y = a;\nendmodule\n");
    const d = structuralToIr(driven, { sourceUri: "t", generation: 1, top: "t" });
    expect(d.modules["t"]!.ports.filter((p) => p.undriven).map((p) => p.name)).toEqual(["z"]);
  });

  it("renders inputs on the left, outputs on the right, each undriven output with a short hint", async () => {
    const file = parser.parse(readFixture(PARTIAL, NAME));
    const view = structuralToIr(file, { sourceUri: NAME, generation: 1, top: "top_module" }).modules["top_module"]!;
    const layout = await layoutView(view);
    const r = renderModule(view, layout, { frame: true });
    const x = (name: string): number => Number(/translate\(([-\d.]+),/.exec(r.inner.slice(r.inner.indexOf(`data-port="${name}"`)))![1]);
    expect(Math.max(x("a"), x("b"))).toBeLessThan(Math.min(...OUTPUTS.map(x)));
    for (const o of OUTPUTS) {
      const at = r.inner.indexOf(`data-port="${o}"`);
      const group = r.inner.slice(r.inner.lastIndexOf("<g ", at), r.inner.indexOf("</g>", at));
      expect(group, o).toContain("not driven yet");
      expect(group, o).toMatch(/class="port port-output[^"]*\bundriven\b/);
    }
    expect(r.inner.slice(r.inner.indexOf('data-port="a"')).slice(0, 400)).not.toContain("not driven yet");
    const tip = portTooltip(view.ports.find((p) => p.name === "out_not")!, "out_not[5:0]", undefined);
    expect(tip).toContain("not driven yet");
  });
});
