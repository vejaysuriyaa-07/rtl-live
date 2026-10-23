import { describe, expect, it } from "vitest";
import { moduleToElk, pinCentres, ROOT_LAYOUT_OPTIONS } from "../../webview/layout/toElk";
import { nodeSize, PIN_PITCH } from "../../webview/render/geometry";
import { renderModule } from "../../webview/render/svg";
import { structuralToIr } from "../../src/structural/toIr";
import { FallbackStructuralParser } from "../../src/structural/fallbackScanner";
import { HDLBITS, readFixture } from "./helpers";
import type { ElkGraphOut } from "../../webview/layout/types";

function docFor(name: string) {
  const file = new FallbackStructuralParser().parse(readFixture(HDLBITS, name));
  return structuralToIr(file, { sourceUri: name, generation: 1, top: "top_module" });
}

describe("toElk", () => {
  it("uses layered, RIGHT, orthogonal routing with model order", () => {
    expect(ROOT_LAYOUT_OPTIONS["elk.algorithm"]).toBe("layered");
    expect(ROOT_LAYOUT_OPTIONS["elk.direction"]).toBe("RIGHT");
    expect(ROOT_LAYOUT_OPTIONS["elk.edgeRouting"]).toBe("ORTHOGONAL");
    expect(ROOT_LAYOUT_OPTIONS["elk.layered.considerModelOrder.strategy"]).toBe("NODES_AND_EDGES");
  });

  it("pins ports to first/last layers and gives every node fixed pin positions one pitch apart", () => {
    const doc = docFor("7458.v");
    const g = moduleToElk(doc.modules["top_module"]!);
    const inNode = g.children.find((c) => c.id === "port:p1a")!;
    expect(inNode.layoutOptions["elk.layered.layering.layerConstraint"]).toBe("FIRST_SEPARATE");
    const outNode = g.children.find((c) => c.id === "port:p1y")!;
    expect(outNode.layoutOptions["elk.layered.layering.layerConstraint"]).toBe("LAST_SEPARATE");
    for (const c of g.children) {
      if (c.id.startsWith("port:")) continue;
      expect(c.layoutOptions["elk.portConstraints"]).toBe("FIXED_POS");
      const west = c.ports.filter((p) => p.layoutOptions["elk.port.side"] === "WEST");
      for (const p of c.ports) {
        expect(p.layoutOptions["elk.port.side"]).toMatch(/WEST|EAST|SOUTH|NORTH/);
        expect(p.x).toBeDefined();
        expect(p.y).toBeDefined();
        if (p.layoutOptions["elk.port.side"] === "WEST") expect(p.x).toBe(-1);
        if (p.layoutOptions["elk.port.side"] === "EAST") expect(p.x).toBe(c.width);
      }
      // Pins keep IR order top to bottom at PIN_PITCH, centred on the node (bug 19).
      for (let i = 1; i < west.length; i++) expect(west[i]!.y! - west[i - 1]!.y!).toBe(PIN_PITCH);
      if (west.length > 0) expect(west[0]!.y! + west[west.length - 1]!.y! + 1).toBeCloseTo(c.height, 5);
    }
    expect(g.edges.length).toBeGreaterThan(0);
  });

  it("places gate inputs 16 px apart inside the symbol and grows the symbol for more inputs", () => {
    const gate = (inputs: number) => ({
      id: "g",
      kind: "gate" as const,
      op: "and",
      width: 1,
      label: "AND",
      src: [],
      pins: [...Array.from({ length: inputs }, (_, i) => ({ id: `I${i}`, label: "", direction: "in" as const, side: "west" as const, width: 1, net: null })), { id: "Y", label: "", direction: "out" as const, side: "east" as const, width: 1, net: null }],
    });
    expect(pinCentres(2, 0, 30)).toEqual([7, 23]);
    expect(pinCentres(1, 0, 30)).toEqual([15]);
    expect(nodeSize(gate(2)).height).toBe(30);
    expect(nodeSize(gate(3)).height).toBe(46);
    expect(pinCentres(3, 0, 46)).toEqual([7, 23, 39]);
  });

  it("sorts nodes by id for stable layouts", () => {
    const doc = docFor("7458.v");
    const ids = moduleToElk(doc.modules["top_module"]!)
      .children.filter((c) => !c.id.startsWith("port:"))
      .map((c) => c.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("svg renderer", () => {
  it("renders ports with data-port attributes and a module frame", () => {
    const doc = docFor("wire.v");
    const view = doc.modules["top_module"]!;
    const g = moduleToElk(view);
    // Fake layout: place children in a row.
    const layout: ElkGraphOut = {
      id: "root",
      width: 300,
      height: 100,
      children: g.children.map((c, i) => ({ id: c.id, x: 10 + i * 90, y: 20, width: c.width, height: c.height, ports: c.ports.map((p) => ({ ...p, x: 0, y: 10 })) })),
      edges: g.edges.map((e) => ({ ...e, sections: [{ id: `${e.id}:s`, startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 10 } }] })),
    };
    const r = renderModule(view, layout);
    expect(r.inner).toContain('data-port="in"');
    expect(r.inner).toContain('data-port="out"');
    expect(r.inner).toContain("module-title");
    expect(r.inner).not.toMatch(/https?:/);
  });
});
