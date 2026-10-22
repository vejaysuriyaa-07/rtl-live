import { describe, expect, it } from "vitest";
import { overlayStructural, overlaySummaryText } from "../../src/ir/overlay";
import type { Port, SchematicDoc } from "../../src/ir/types";

function port(name: string, direction: Port["direction"] = "input", width = 1): Port {
  return { name, direction, width, src: [{ line: 1, column: 1, endLine: 1, endColumn: 2 }] };
}

function doc(fidelity: "structural" | "synthesized", ports: Port[], generation = 1): SchematicDoc {
  return {
    version: 1,
    fidelity,
    top: "m",
    modules: { m: { name: "m", ports, nodes: [{ id: "g", kind: "gate", op: "and", width: 1, pins: [], label: "AND", src: [] }], nets: [] } },
    moduleNames: ["m"],
    diagnostics: [],
    sourceUri: "t",
    generation,
  };
}

describe("stale overlay", () => {
  it("marks added, removed and changed ports and keeps the old nodes", () => {
    const good = doc("synthesized", [port("a"), port("b"), port("y", "output")]);
    const fresh = doc("structural", [port("a"), port("y", "output", 4), port("c")], 7);
    fresh.diagnostics = [{ severity: "error", message: "missing ';'", line: 2, column: 5, source: "structural" }];
    const { doc: out, summary } = overlayStructural(good, fresh, 7);
    expect(summary).toEqual({ added: ["c"], removed: ["b"], changed: ["y"] });
    expect(overlaySummaryText(summary)).toBe("1 port added, 1 removed, 1 changed");
    expect(out.generation).toBe(7);
    expect(out.fidelity).toBe("synthesized");
    expect(out.diagnostics[0]?.message).toBe("missing ';'");
    const ports = out.modules["m"]!.ports;
    expect(ports.map((p) => [p.name, p.ghost ?? "", p.width])).toEqual([
      ["a", "", 1],
      ["b", "removed", 1],
      ["y", "changed", 4],
      ["c", "added", 1],
    ]);
    expect(out.modules["m"]!.nodes).toHaveLength(1);
    // The input docs are untouched.
    expect(good.modules["m"]!.ports.some((p) => p.ghost)).toBe(false);
  });

  it("is a no-op overlay when nothing changed and clears stale ghosts", () => {
    const good = doc("synthesized", [port("a")]);
    good.modules["m"]!.ports[0]!.ghost = "removed";
    const { doc: out, summary } = overlayStructural(good, doc("structural", [port("a")]), 2);
    expect(summary).toEqual({ added: [], removed: [], changed: [] });
    expect(out.modules["m"]!.ports[0]!.ghost).toBeUndefined();
    expect(overlaySummaryText(summary)).toBe("");
  });

  it("keeps the last good diagram when the top module vanished from the text", () => {
    const good = doc("synthesized", [port("a")]);
    const fresh: SchematicDoc = { ...doc("structural", []), modules: {}, moduleNames: [] };
    const { doc: out } = overlayStructural(good, fresh, 3);
    expect(out.modules["m"]!.ports).toEqual(good.modules["m"]!.ports);
    expect(out.moduleNames).toEqual(["m"]);
  });
});
