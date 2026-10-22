// Bug 10: with no logic to draw, ports must still sit on the module edges in
// declaration order, inputs left and outputs right, not in a packed grid.
import { describe, expect, it } from "vitest";
import { FallbackStructuralParser } from "../../src/structural/fallbackScanner";
import { structuralToIr } from "../../src/structural/toIr";
import { portNodeId } from "../../webview/layout/toElk";
import { layoutView } from "../accuracy/layout";

async function positions(text: string) {
  const file = new FallbackStructuralParser().parse(text);
  const doc = structuralToIr(file, { sourceUri: "t", generation: 1, top: "top_module" });
  const view = doc.modules["top_module"]!;
  const layout = await layoutView(view);
  const at = (name: string) => layout.children.find((c) => c.id === portNodeId(name))!;
  return { view, at };
}

describe("port placement without logic", () => {
  for (const text of ["module top_module(input p1a, p1b, p1c, output p1y, input p2a, p2b, output p2y", "module top_module(input p1a, p1b, p1c, output p1y, input p2a, p2b, output p2y);\nendmodule\n"]) {
    it(`inputs left, outputs right, declaration order top to bottom: ${text.slice(-12)}`, async () => {
      const { view, at } = await positions(text);
      const inputs = view.ports.filter((p) => p.direction === "input").map((p) => at(p.name));
      const outputs = view.ports.filter((p) => p.direction === "output").map((p) => at(p.name));
      expect(inputs.length).toBe(5);
      expect(outputs.length).toBe(2);
      const maxInRight = Math.max(...inputs.map((n) => n.x + n.width));
      const minOutLeft = Math.min(...outputs.map((n) => n.x));
      expect(maxInRight, "every input left of every output").toBeLessThan(minOutLeft);
      expect(new Set(inputs.map((n) => Math.round(n.x))).size, "inputs share one column").toBe(1);
      expect(new Set(outputs.map((n) => Math.round(n.x))).size, "outputs share one column").toBe(1);
      for (let i = 1; i < inputs.length; i++) expect(inputs[i]!.y, "inputs keep declaration order").toBeGreaterThan(inputs[i - 1]!.y);
      expect(outputs[1]!.y).toBeGreaterThan(outputs[0]!.y);
    });
  }
});
