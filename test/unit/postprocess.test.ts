// A trunk with branches leaving up and down at one point is a 4-way cross; the post-pass
// slides one branch along the trunk so the net only has T junctions (bug 14).
import { describe, expect, it } from "vitest";
import { junctionOffset, MIN_DOT_GAP, separateJunctions } from "../../webview/layout/postprocess";
import type { ElkGraphOut } from "../../webview/layout/types";

function cross(branchEndsOnPin: boolean): ElkGraphOut {
  const up = branchEndsOnPin ? [{ x: 150, y: 150 }] : [{ x: 150, y: 150 }, { x: 150, y: 40 }];
  const down = branchEndsOnPin ? [{ x: 150, y: 150 }] : [{ x: 150, y: 150 }, { x: 150, y: 260 }];
  return {
    id: "root",
    width: 300,
    height: 300,
    children: [],
    edges: [
      { id: "edge:net:a:0", sources: ["p.a"], targets: ["q.y"], sections: [{ id: "s1", startPoint: { x: 30, y: 150 }, endPoint: { x: 250, y: 150 } }], junctionPoints: [{ x: 150, y: 150 }] },
      { id: "edge:net:a:1", sources: ["p.a"], targets: ["n.n"], sections: [{ id: "s2", startPoint: { x: 30, y: 150 }, bendPoints: up, endPoint: { x: 200, y: 40 } }] },
      { id: "edge:net:a:2", sources: ["p.a"], targets: ["s.s"], sections: [{ id: "s3", startPoint: { x: 30, y: 150 }, bendPoints: down, endPoint: { x: 200, y: 260 } }] },
    ],
  };
}

describe("separateJunctions", () => {
  it("slides one branch by the offset and rebuilds the dots as two T junctions", () => {
    const out = separateJunctions(cross(false), () => MIN_DOT_GAP);
    const dots = out.edges.flatMap((e) => e.junctionPoints ?? []);
    expect(dots).toEqual([
      { x: 170, y: 150 },
      { x: 150, y: 150 },
    ]);
    const moved = out.edges[1]!.sections![0]!;
    expect(moved.bendPoints).toEqual([
      { x: 170, y: 150 },
      { x: 170, y: 40 },
    ]);
    expect(out.edges[2]!.sections![0]!.bendPoints).toEqual([
      { x: 150, y: 150 },
      { x: 150, y: 260 },
    ]);
  });

  it("leaves a cross alone when both branch legs end on a pin", () => {
    const input = cross(true);
    const out = separateJunctions(input, () => 8);
    expect(out.edges.map((e) => e.sections)).toEqual(input.edges.map((e) => e.sections));
  });

  it("keeps the moved branch clear of other nets", () => {
    const g = cross(false);
    // Another net's vertical wire sits 6 px right of where the branch would land: it slides left instead.
    g.edges.push({ id: "edge:net:b:0", sources: ["r.b"], targets: ["t.z"], sections: [{ id: "s4", startPoint: { x: 164, y: 0 }, endPoint: { x: 164, y: 300 } }] });
    const out = separateJunctions(g, () => MIN_DOT_GAP);
    expect(out.edges[1]!.sections![0]!.bendPoints![0]).toEqual({ x: 130, y: 150 });
  });

  it("offset keeps two dots at least 20 px apart (bug 19)", () => {
    expect(junctionOffset(3)).toBe(MIN_DOT_GAP);
    expect(junctionOffset(6)).toBe(MIN_DOT_GAP);
    expect(junctionOffset(12)).toBe(26);
    const out = separateJunctions(cross(false), (net) => junctionOffset(net === "net:a" ? 3 : 6));
    expect(out.edges.flatMap((e) => e.junctionPoints ?? [])).toEqual([
      { x: 170, y: 150 },
      { x: 150, y: 150 },
    ]);
  });

  it("slides a branch so its dot is 16 px clear of a plain crossing (bug 19)", () => {
    const g: ElkGraphOut = {
      id: "root",
      width: 300,
      height: 300,
      children: [],
      edges: [
        { id: "edge:net:a:0", sources: ["p.a"], targets: ["q.y"], sections: [{ id: "s1", startPoint: { x: 30, y: 150 }, endPoint: { x: 250, y: 150 } }], junctionPoints: [{ x: 150, y: 150 }] },
        { id: "edge:net:a:1", sources: ["p.a"], targets: ["n.n"], sections: [{ id: "s2", startPoint: { x: 30, y: 150 }, bendPoints: [{ x: 150, y: 150 }, { x: 150, y: 40 }], endPoint: { x: 200, y: 40 } }] },
        // Another net crosses the trunk 10 px right of the dot.
        { id: "edge:net:b:0", sources: ["r.b"], targets: ["t.z"], sections: [{ id: "s3", startPoint: { x: 160, y: 0 }, endPoint: { x: 160, y: 300 } }] },
      ],
    };
    const out = separateJunctions(g, () => MIN_DOT_GAP);
    expect(out.edges.flatMap((e) => e.junctionPoints ?? [])).toEqual([{ x: 142, y: 150 }]);
    expect(out.edges[1]!.sections![0]!.bendPoints).toEqual([
      { x: 142, y: 150 },
      { x: 142, y: 40 },
    ]);
    expect(out.edges[2]!.sections).toEqual(g.edges[2]!.sections);
  });

  it("slides a branch so dots of two nets are 20 px apart (bug 19)", () => {
    const g: ElkGraphOut = {
      id: "root",
      width: 300,
      height: 300,
      children: [],
      edges: [
        { id: "edge:net:a:0", sources: ["p.a"], targets: ["q.y"], sections: [{ id: "s1", startPoint: { x: 30, y: 150 }, endPoint: { x: 250, y: 150 } }], junctionPoints: [{ x: 150, y: 150 }] },
        { id: "edge:net:a:1", sources: ["p.a"], targets: ["n.n"], sections: [{ id: "s2", startPoint: { x: 30, y: 150 }, bendPoints: [{ x: 150, y: 150 }, { x: 150, y: 40 }], endPoint: { x: 200, y: 40 } }] },
        // Net b's dot is 16 px away diagonally and its branch leg ends on a pin, so net a moves.
        { id: "edge:net:b:0", sources: ["r.b"], targets: ["t.z"], sections: [{ id: "s3", startPoint: { x: 30, y: 165 }, endPoint: { x: 250, y: 165 } }], junctionPoints: [{ x: 156, y: 165 }] },
        { id: "edge:net:b:1", sources: ["r.b"], targets: ["u.w"], sections: [{ id: "s4", startPoint: { x: 30, y: 165 }, bendPoints: [{ x: 156, y: 165 }], endPoint: { x: 156, y: 260 } }] },
      ],
    };
    const out = separateJunctions(g, () => MIN_DOT_GAP);
    const dots = out.edges.flatMap((e) => e.junctionPoints ?? []);
    expect(dots).toEqual([
      { x: 142, y: 150 },
      { x: 156, y: 165 },
    ]);
  });

  it("leaves a crowded dot alone when no slide within reach clears it", () => {
    const g = cross(false);
    g.edges.splice(2, 1); // a T: trunk plus the branch going up
    g.edges[0]!.sections![0]!.startPoint = { x: 126, y: 150 };
    g.edges[0]!.sections![0]!.endPoint = { x: 174, y: 150 };
    g.edges[1]!.sections![0]!.startPoint = { x: 126, y: 150 };
    // The trunk runs 24 px each way and verticals of other nets fence the dot in 10 px away on
    // both sides: every slide that keeps the dot on the trunk either runs within 8 px of a fence
    // or stays within 16 px of its crossing.
    g.edges.push({ id: "edge:net:b:0", sources: ["r.b"], targets: ["t.z"], sections: [{ id: "s4", startPoint: { x: 160, y: 0 }, endPoint: { x: 160, y: 300 } }] });
    g.edges.push({ id: "edge:net:c:0", sources: ["v.c"], targets: ["w.z"], sections: [{ id: "s5", startPoint: { x: 140, y: 0 }, endPoint: { x: 140, y: 300 } }] });
    const out = separateJunctions(g, () => MIN_DOT_GAP);
    expect(out.edges[1]!.sections).toEqual(g.edges[1]!.sections);
    expect(out.edges.flatMap((e) => e.junctionPoints ?? [])).toEqual([{ x: 150, y: 150 }]);
  });
});
