// Layout post-pass shared by the webview and the layout checks: a trunk with branches
// leaving in opposite directions at one point reads as a 4-way cross, so one branch is
// slid along the trunk into a second T junction (BUG_HUNT.md Part B lines).
import type { ElkEdgeOut, ElkGraphOut, ElkPoint } from "./types";

const EPS = 0.01;

export function netOfEdge(edgeId: string): string {
  return edgeId.replace(/^edge:/, "").replace(/:\d+$/, "");
}

/** Offset between the two T junctions: clear of both dots plus a gap. */
export function junctionOffset(dotRadius: number): number {
  return Math.max(8, Math.ceil(2 * dotRadius + 2));
}

interface Seg {
  a: ElkPoint;
  b: ElkPoint;
}

function same(p: ElkPoint, q: ElkPoint): boolean {
  return Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS;
}

function pointsOf(e: ElkEdgeOut): ElkPoint[][] {
  return (e.sections ?? []).map((s) => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
}

function segmentsOf(edges: ElkEdgeOut[]): Seg[] {
  const out: Seg[] = [];
  for (const e of edges) for (const pts of pointsOf(e)) for (let i = 0; i + 1 < pts.length; i++) if (!same(pts[i]!, pts[i + 1]!)) out.push({ a: pts[i]!, b: pts[i + 1]! });
  return out;
}

type Dir = "N" | "S" | "E" | "W";

/** Directions in which wires leave a point, with the longest run available in each. */
function runsAt(segs: Seg[], pt: ElkPoint): Map<Dir, number> {
  const runs = new Map<Dir, number>();
  for (const s of segs) {
    const horizontal = Math.abs(s.a.y - s.b.y) < EPS;
    const onSeg = horizontal
      ? Math.abs(s.a.y - pt.y) < EPS && pt.x >= Math.min(s.a.x, s.b.x) - EPS && pt.x <= Math.max(s.a.x, s.b.x) + EPS
      : Math.abs(s.a.x - pt.x) < EPS && pt.y >= Math.min(s.a.y, s.b.y) - EPS && pt.y <= Math.max(s.a.y, s.b.y) + EPS;
    if (!onSeg) continue;
    for (const end of [s.a, s.b]) {
      if (same(end, pt)) continue;
      const dir: Dir = horizontal ? (end.x > pt.x ? "E" : "W") : end.y > pt.y ? "S" : "N";
      const len = horizontal ? Math.abs(end.x - pt.x) : Math.abs(end.y - pt.y);
      runs.set(dir, Math.max(runs.get(dir) ?? 0, len));
    }
  }
  return runs;
}

function cloneEdges(edges: ElkEdgeOut[]): ElkEdgeOut[] {
  return edges.map((e) => ({
    ...e,
    ...(e.sections
      ? { sections: e.sections.map((s) => ({ ...s, startPoint: { ...s.startPoint }, endPoint: { ...s.endPoint }, ...(s.bendPoints ? { bendPoints: s.bendPoints.map((b) => ({ ...b })) } : {}) })) }
      : {}),
    ...(e.junctionPoints ? { junctionPoints: e.junctionPoints.map((j) => ({ ...j })) } : {}),
  }));
}

/**
 * Slides one branch of every 4-way junction along its trunk so each net only has T
 * junctions. `offsetOf` gives the slide distance for a net (bigger dots need more room).
 */
/** Minimum distance a moved branch keeps from wires of other nets. */
const CLEARANCE = 8;

interface NetSeg extends Seg {
  net: string;
}

function allSegments(edges: ElkEdgeOut[]): NetSeg[] {
  const out: NetSeg[] = [];
  for (const e of edges) {
    const net = netOfEdge(e.id);
    for (const s of segmentsOf([e])) out.push({ ...s, net });
  }
  return out;
}

/** True when the segment keeps CLEARANCE from every parallel segment and crossing of another net. */
function clearOfOthers(seg: Seg, net: string, others: NetSeg[]): boolean {
  const vertical = Math.abs(seg.a.x - seg.b.x) < EPS;
  const lo = vertical ? Math.min(seg.a.y, seg.b.y) : Math.min(seg.a.x, seg.b.x);
  const hi = vertical ? Math.max(seg.a.y, seg.b.y) : Math.max(seg.a.x, seg.b.x);
  const at = vertical ? seg.a.x : seg.a.y;
  for (const o of others) {
    if (o.net === net) continue;
    const oVertical = Math.abs(o.a.x - o.b.x) < EPS;
    if (oVertical === vertical) {
      const oLo = vertical ? Math.min(o.a.y, o.b.y) : Math.min(o.a.x, o.b.x);
      const oHi = vertical ? Math.max(o.a.y, o.b.y) : Math.max(o.a.x, o.b.x);
      const oAt = vertical ? o.a.x : o.a.y;
      if (Math.min(hi, oHi) - Math.max(lo, oLo) > -CLEARANCE && Math.abs(at - oAt) < CLEARANCE - EPS) return false;
    } else {
      // A perpendicular wire of another net must not pass through either end of the moved leg.
      const oAt = oVertical ? o.a.x : o.a.y;
      const oLo = oVertical ? Math.min(o.a.y, o.b.y) : Math.min(o.a.x, o.b.x);
      const oHi = oVertical ? Math.max(o.a.y, o.b.y) : Math.max(o.a.x, o.b.x);
      for (const end of [seg.a, seg.b]) {
        const endAlong = vertical ? end.y : end.x;
        const endAcross = vertical ? end.x : end.y;
        if (Math.abs(endAcross - oAt) < CLEARANCE - EPS && endAlong > oLo - CLEARANCE && endAlong < oHi + CLEARANCE) return false;
      }
    }
  }
  return true;
}

/** Junction dots recomputed from the geometry: every point of the net where three or more wires meet. */
function rebuildJunctions(netEdges: ElkEdgeOut[]): void {
  const segs = segmentsOf(netEdges);
  const seen: ElkPoint[] = [];
  for (const e of netEdges) {
    for (const pts of pointsOf(e)) {
      for (const p of pts) {
        if (seen.some((q) => same(p, q))) continue;
        seen.push(p);
      }
    }
  }
  const dots = seen.filter((p) => runsAt(segs, p).size >= 3).map((p) => ({ x: p.x, y: p.y }));
  netEdges.forEach((e, i) => {
    if (i === 0) e.junctionPoints = dots;
    else delete e.junctionPoints;
  });
}

export function separateJunctions(layout: ElkGraphOut, offsetOf: (netId: string) => number): ElkGraphOut {
  const edges = cloneEdges(layout.edges);
  const byNet = new Map<string, ElkEdgeOut[]>();
  for (const e of edges) {
    const net = netOfEdge(e.id);
    (byNet.get(net) ?? byNet.set(net, []).get(net)!).push(e);
  }
  for (const [net, netEdges] of byNet) {
    const offset = offsetOf(net);
    let touched = false;
    for (let guard = 0; guard < 16; guard++) {
      const segs = segmentsOf(netEdges);
      const others = allSegments(edges);
      const fourWay = segs.flatMap((s) => [s.a, s.b]).filter((p, i, arr) => arr.findIndex((q) => same(p, q)) === i && runsAt(segs, p).size >= 4);
      let moved = false;
      for (const j of fourWay) {
        if (slideBranch(netEdges, net, j, runsAt(segs, j), offset, others)) {
          moved = true;
          touched = true;
          break;
        }
      }
      if (!moved) break;
    }
    if (touched || netEdges.some((e) => (e.junctionPoints ?? []).length > 0)) rebuildJunctions(netEdges);
  }
  return { ...layout, edges };
}

/** Moves one branch bend at `j` along the trunk, by a multiple of `offset` that keeps clear of other nets. */
function slideBranch(netEdges: ElkEdgeOut[], net: string, j: ElkPoint, runs: Map<Dir, number>, offset: number, others: NetSeg[]): boolean {
  for (const e of netEdges) {
    for (const s of e.sections ?? []) {
      const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
      for (let k = 1; k + 1 < pts.length; k++) {
        if (!same(pts[k]!, j)) continue;
        const prev = pts[k - 1]!;
        const next = pts[k + 1]!;
        const trunkHorizontal = Math.abs(prev.y - j.y) < EPS;
        const branchVertical = Math.abs(next.x - j.x) < EPS;
        if (trunkHorizontal !== branchVertical) continue; // the turn is not trunk-then-branch
        if (k + 1 === pts.length - 1) continue; // the branch leg ends on a pin and cannot shift
        const legLen = trunkHorizontal ? Math.abs(next.y - j.y) : Math.abs(next.x - j.x);
        if (legLen < EPS) continue;
        for (const mult of [1, 2, 3]) {
          for (const sign of [1, -1]) {
            const d = sign * offset * mult;
            const run = runs.get(trunkHorizontal ? (sign > 0 ? "E" : "W") : sign > 0 ? "S" : "N") ?? 0;
            if (run < Math.abs(d) + offset) continue;
            const movedJ = trunkHorizontal ? { x: j.x + d, y: j.y } : { x: j.x, y: j.y + d };
            const movedNext = trunkHorizontal ? { x: next.x + d, y: next.y } : { x: next.x, y: next.y + d };
            if (!clearOfOthers({ a: movedJ, b: movedNext }, net, others)) continue;
            pts[k]!.x = movedJ.x;
            pts[k]!.y = movedJ.y;
            pts[k + 1]!.x = movedNext.x;
            pts[k + 1]!.y = movedNext.y;
            return true;
          }
        }
      }
    }
  }
  return false;
}
