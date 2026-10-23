// The legend must show every symbol the renderer can draw, each with a meaning.
import { describe, expect, it } from "vitest";
import type { NodeKind } from "../../src/ir/types";
import { legendItems } from "../../webview/ui/legend";

const ALL_KINDS: NodeKind[] = ["gate", "reduce", "mux", "pmux", "dff", "arith", "compare", "shift", "const", "instance", "blackbox", "split", "join", "cloud", "unknown"];

describe("legend", () => {
  it("covers every node kind plus ports, wires, buses, junctions, crossings and warnings", () => {
    const items = legendItems();
    const covered = new Set(items.flatMap((i) => i.kinds));
    for (const k of ALL_KINDS) expect(covered, k).toContain(k);
    for (const key of ["input", "output", "wire", "bus", "junction", "crossing", "not", "logical", "any", "join", "split", "warning"]) expect(items.map((i) => i.key)).toContain(key);
  });

  it("every item has a sample drawn with the symbol classes and a one-sentence meaning", () => {
    for (const item of legendItems()) {
      expect(item.title.length, item.key).toBeGreaterThan(2);
      expect(item.text, item.key).toMatch(/[.?!]$/);
      expect(item.text.split(/[.?!]\s/).length, item.key).toBeLessThanOrEqual(2);
      expect(item.svg, item.key).toMatch(/class="(net-path|port-shape|gate-body|body|ripper|junction|warn-badge)/);
      expect(item.width, item.key).toBeGreaterThan(0);
      expect(item.height, item.key).toBeGreaterThan(0);
      expect(new Set(legendItems().map((i) => i.key)).size).toBe(legendItems().length);
    }
  });
});
