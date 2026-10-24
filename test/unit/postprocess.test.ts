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
  it("never parks a second branch where the first one went (arith_compare, net b)", () => {
    // Trunk from a port east to a pin; at x=111 one branch goes up and two go down, the second
    // further than the first. Sliding the first down-branch west by 20 leaves a 4-way at 111, and the
    // old pass then slid the up-branch to the same x and made a new 4-way there.
    const g: ElkGraphOut = {
      id: "root",
      width: 300,
      height: 300,
      children: [],
      edges: [
        { id: "edge:net:b:0", sources: ["p.b"], targets: ["add.B"], sections: [{ id: "s0", startPoint: { x: 83, y: 123 }, bendPoints: [{ x: 111, y: 123 }, { x: 111, y: 193 }], endPoint: { x: 155, y: 193 } }], junctionPoints: [{ x: 111, y: 123 }, { x: 111, y: 193 }] },
        { id: "edge:net:b:1", sources: ["p.b"], targets: ["sub.B"], sections: [{ id: "s1", startPoint: { x: 83, y: 123 }, endPoint: { x: 155, y: 123 } }] },
        { id: "edge:net:b:2", sources: ["p.b"], targets: ["lt.B"], sections: [{ id: "s2", startPoint: { x: 83, y: 123 }, bendPoints: [{ x: 111, y: 123 }, { x: 111, y: 53 }], endPoint: { x: 155, y: 53 } }] },
        { id: "edge:net:b:3", sources: ["p.b"], targets: ["eq.B"], sections: [{ id: "s3", startPoint: { x: 83, y: 123 }, bendPoints: [{ x: 111, y: 123 }, { x: 111, y: 263 }], endPoint: { x: 155, y: 263 } }] },
        // Net a as laid out in arith_compare: a trunk at y=37, a vertical at x=127 and horizontals
        // into the pins at y=107, 177 and 247. None of them touches x=111, where a slid branch of
        // net b may land; a clearance test that mixes up the axes used to say otherwise.
        { id: "edge:net:a:0", sources: ["p.a"], targets: ["add.A"], sections: [{ id: "s4", startPoint: { x: 83, y: 37 }, bendPoints: [{ x: 127, y: 37 }, { x: 127, y: 177 }], endPoint: { x: 155, y: 177 } }], junctionPoints: [{ x: 127, y: 37 }, { x: 127, y: 177 }] },
        { id: "edge:net:a:1", sources: ["p.a"], targets: ["sub.A"], sections: [{ id: "s5", startPoint: { x: 83, y: 37 }, bendPoints: [{ x: 127, y: 37 }, { x: 127, y: 107 }], endPoint: { x: 155, y: 107 } }], junctionPoints: [{ x: 127, y: 107 }] },
        { id: "edge:net:a:2", sources: ["p.a"], targets: ["lt.A"], sections: [{ id: "s6", startPoint: { x: 83, y: 37 }, endPoint: { x: 155, y: 37 } }] },
        { id: "edge:net:a:3", sources: ["p.a"], targets: ["eq.A"], sections: [{ id: "s7", startPoint: { x: 83, y: 37 }, bendPoints: [{ x: 127, y: 37 }, { x: 127, y: 247 }], endPoint: { x: 155, y: 247 } }] },
      ],
    };
    const out = separateJunctions(g, () => MIN_DOT_GAP);
    // Directions in which wires of net b leave each of its points, counting wires that pass
    // through the point as well as wires that end there (as the accuracy check does).
    const segs: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
    for (const e of out.edges) {
      if (!e.id.startsWith("edge:net:b:")) continue;
      for (const s of e.sections ?? []) {
        const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
        for (let k = 0; k + 1 < pts.length; k++) segs.push({ a: pts[k]!, b: pts[k + 1]! });
      }
    }
    const dirs = new Map<string, Set<string>>();
    for (const p of segs.flatMap((sg) => [sg.a, sg.b])) {
      const key = `${p.x},${p.y}`;
      const d = dirs.get(key) ?? dirs.set(key, new Set()).get(key)!;
      for (const sg of segs) {
        const horizontal = sg.a.y === sg.b.y;
        const on = horizontal ? p.y === sg.a.y && p.x >= Math.min(sg.a.x, sg.b.x) && p.x <= Math.max(sg.a.x, sg.b.x) : p.x === sg.a.x && p.y >= Math.min(sg.a.y, sg.b.y) && p.y <= Math.max(sg.a.y, sg.b.y);
        if (!on) continue;
        for (const end of [sg.a, sg.b]) {
          if (end.x === p.x && end.y === p.y) continue;
          d.add(horizontal ? (end.x > p.x ? "E" : "W") : end.y > p.y ? "S" : "N");
        }
      }
    }
    const fourWay = [...dirs].filter(([, d]) => d.size >= 4).map(([k]) => k);
    expect(fourWay, "4-way points of net b").toEqual([]);
  });

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

  it("keeps the end of the moved leg off a perpendicular wire of another net", () => {
    const g = cross(false);
    // Net c runs horizontally at y=40 from x=160 to 240: the up-branch slid east to x=170 would end
    // on it (170,40), so the branch slides west to x=130 instead.
    g.edges.push({ id: "edge:net:c:0", sources: ["u.c"], targets: ["v.c"], sections: [{ id: "s5", startPoint: { x: 160, y: 40 }, endPoint: { x: 240, y: 40 } }] });
    const out = separateJunctions(g, () => MIN_DOT_GAP);
    expect(out.edges[1]!.sections![0]!.bendPoints).toEqual([
      { x: 130, y: 150 },
      { x: 130, y: 40 },
    ]);
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
