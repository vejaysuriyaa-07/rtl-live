// A trunk with branches leaving up and down at one point is a 4-way cross; the post-pass
// slides one branch along the trunk so the net only has T junctions (bug 14).
import { describe, expect, it } from "vitest";
import { junctionOffset, separateJunctions } from "../../webview/layout/postprocess";
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
    const out = separateJunctions(cross(false), () => 8);
    const dots = out.edges.flatMap((e) => e.junctionPoints ?? []);
    expect(dots).toEqual([
      { x: 158, y: 150 },
      { x: 150, y: 150 },
    ]);
    const moved = out.edges[1]!.sections![0]!;
    expect(moved.bendPoints).toEqual([
      { x: 158, y: 150 },
      { x: 158, y: 40 },
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
    // Another net's vertical wire sits 4 px right of the cross: the branch must slide left instead.
    g.edges.push({ id: "edge:net:b:0", sources: ["r.b"], targets: ["t.z"], sections: [{ id: "s4", startPoint: { x: 160, y: 0 }, endPoint: { x: 160, y: 300 } }] });
    const out = separateJunctions(g, () => 8);
    expect(out.edges[1]!.sections![0]!.bendPoints![0]).toEqual({ x: 142, y: 150 });
  });

  it("offset clears two dots and never drops under 8 px", () => {
    expect(junctionOffset(3)).toBe(8);
    expect(junctionOffset(6)).toBe(14);
  });
});
