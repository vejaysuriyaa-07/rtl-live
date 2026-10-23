// v0.4 shapes: wire bends get a small arc unless they sit next to a junction dot or a pin,
// and port chevrons and boxes get rounded corners.
import { describe, expect, it } from "vitest";
import type { ElkEdgeOut } from "../../webview/layout/types";
import { RADIUS } from "../../webview/render/tokens";
import { edgePath, portShapePath, roundedPolygonPath } from "../../webview/render/svg";

function edge(points: { x: number; y: number }[], junctions: { x: number; y: number }[] = []): ElkEdgeOut {
  const [start, ...rest] = points;
  const end = rest.pop()!;
  return { id: "edge:net:a:0", sources: ["port:a.a"], targets: ["n.A"], sections: [{ id: "s", startPoint: start!, endPoint: end, bendPoints: rest }], junctionPoints: junctions };
}

describe("wire bends", () => {
  it("rounds a bend far from everything with a 4 px arc", () => {
    const d = edgePath(edge([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]), []);
    expect(d).toBe(`M0,0 L${50 - RADIUS.bend},0 Q50,0 50,${RADIUS.bend} L50,50`);
  });
  it("keeps a bend sharp within 8 px of a junction dot of its net", () => {
    const guards = [{ x: 50, y: 0 }];
    expect(edgePath(edge([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]), guards)).toBe("M0,0 L50,0 L50,50");
    const near = [{ x: 50, y: RADIUS.bendGuard - 1 }];
    expect(edgePath(edge([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]), near)).toBe("M0,0 L50,0 L50,50");
    const far = [{ x: 50, y: RADIUS.bendGuard + 1 }];
    expect(edgePath(edge([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]), far)).toContain("Q");
  });
  it("keeps a bend sharp within 8 px of either end of the wire (a pin or a port)", () => {
    expect(edgePath(edge([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 50 }]), [])).toBe("M0,0 L6,0 L6,50");
    expect(edgePath(edge([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 6 }]), [])).toBe("M0,0 L50,0 L50,6");
  });
  it("shrinks the arc on a short middle segment so two arcs never overlap", () => {
    const d = edgePath(edge([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 5 }, { x: 100, y: 5 }]), []);
    expect(d).toBe("M0,0 L47.50,0 Q50,0 50,2.50 L50,2.50 Q50,5 52.50,5 L100,5");
  });
  it("leaves a straight wire alone", () => {
    expect(edgePath(edge([{ x: 0, y: 0 }, { x: 80, y: 0 }]), [])).toBe("M0,0 L80,0");
  });
});

describe("rounded shapes", () => {
  it("rounds every corner of a polygon with an arc and closes it", () => {
    const d = roundedPolygonPath([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }], 4);
    expect(d.match(/Q/g)).toHaveLength(4);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("M0,4 Q0,0 4,0");
  });
  it("port chevrons have rounded corners and still point the right way", () => {
    const input = portShapePath("input", 40, 20);
    const output = portShapePath("output", 40, 20);
    const inout = portShapePath("inout", 40, 20);
    for (const d of [input, output, inout]) expect(d.match(/Q/g)!.length).toBeGreaterThanOrEqual(5);
    expect(input).toContain("40,10");
    expect(output).toContain("0,10");
    expect(inout).toContain("40,10");
    expect(inout).toContain("0,10");
  });
  it("a radius of 0 gives the plain polygon", () => {
    expect(roundedPolygonPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 0)).toBe("M0,0 L10,0 L10,10 Z");
  });
});
