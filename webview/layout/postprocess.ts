// Layout post-pass shared by the webview and the layout checks. ELK merges fan-out edges
// into trunks with junction points; this pass makes those junctions readable:
// a trunk with branches leaving in opposite directions at one point reads as a 4-way
// cross, so one branch is slid along the trunk into a second T junction (BUG_HUNT.md
// Part B lines), and a dot that crowds another dot or a plain crossing is slid clear (bug 19).
import type { ElkEdgeOut, ElkGraphOut, ElkPoint } from "./types";

const EPS = 0.01;

/** Junction dots keep this far apart, centre to centre (bug 19). */
export const MIN_DOT_GAP = 20;
/** A plain crossing keeps this far from any junction dot (bug 19). */
export const MIN_CROSSING_GAP = 16;
/** Minimum distance a moved branch keeps from wires of other nets. */
const CLEARANCE = 8;
/** Slides tried for a crowded dot, nearest first. */
const CROWD_SLIDES = [4, -4, 8, -8, 12, -12, 16, -16, 20, -20, 24, -24, 28, -28, 32, -32];
/** A slid dot stays this far from the end of its trunk so it still reads as a T. */
const TRUNK_MARGIN = 8;

export function netOfEdge(edgeId: string): string {
  return edgeId.replace(/^edge:/, "").replace(/:\d+$/, "");
}

/** Offset between the two T junctions of a separated 4-way: at least MIN_DOT_GAP, clear of both dots. */
export function junctionOffset(dotRadius: number): number {
  return Math.max(MIN_DOT_GAP, Math.ceil(2 * dotRadius + 2));
}

interface Seg {
  a: ElkPoint;
  b: ElkPoint;
}

interface NetSeg extends Seg {
  net: string;
}

interface Dot extends ElkPoint {
  net: string;
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

function allSegments(edges: ElkEdgeOut[]): NetSeg[] {
  const out: NetSeg[] = [];
  for (const e of edges) {
    const net = netOfEdge(e.id);
    for (const s of segmentsOf([e])) out.push({ ...s, net });
  }
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

/** Every point of a net where three or more wires meet. */
function dotsOf(net: string, netEdges: ElkEdgeOut[]): Dot[] {
  const segs = segmentsOf(netEdges);
  const seen: ElkPoint[] = [];
  for (const e of netEdges) for (const pts of pointsOf(e)) for (const p of pts) if (!seen.some((q) => same(p, q))) seen.push(p);
  return seen.filter((p) => runsAt(segs, p).size >= 3).map((p) => ({ net, x: p.x, y: p.y }));
}

/** Junction dots recomputed from the geometry. */
function rebuildJunctions(net: string, netEdges: ElkEdgeOut[]): void {
  const dots = dotsOf(net, netEdges).map((d) => ({ x: d.x, y: d.y }));
  netEdges.forEach((e, i) => {
    if (i === 0) e.junctionPoints = dots;
    else delete e.junctionPoints;
  });
}

/** Points where a horizontal and a vertical wire of different nets cross in their interiors. */
function crossingsOf(segs: NetSeg[]): ElkPoint[] {
  const out: ElkPoint[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i]!;
      const q = segs[j]!;
      if (p.net === q.net) continue;
      const pH = Math.abs(p.a.y - p.b.y) < EPS;
      const qH = Math.abs(q.a.y - q.b.y) < EPS;
      if (pH === qH) continue;
      const h = pH ? p : q;
      const v = pH ? q : p;
      const x = v.a.x;
      const y = h.a.y;
      if (x <= Math.min(h.a.x, h.b.x) + EPS || x >= Math.max(h.a.x, h.b.x) - EPS || y <= Math.min(v.a.y, v.b.y) + EPS || y >= Math.max(v.a.y, v.b.y) - EPS) continue;
      if (!out.some((c) => same(c, { x, y }))) out.push({ x, y });
    }
  }
  return out;
}

/** Number of dot pairs under MIN_DOT_GAP plus dot-crossing pairs under MIN_CROSSING_GAP. */
function crowding(dots: Dot[], crossings: ElkPoint[]): number {
  let n = 0;
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) if (Math.hypot(dots[i]!.x - dots[j]!.x, dots[i]!.y - dots[j]!.y) < MIN_DOT_GAP - EPS) n++;
    for (const c of crossings) if (Math.hypot(dots[i]!.x - c.x, dots[i]!.y - c.y) < MIN_CROSSING_GAP - EPS) n++;
  }
  return n;
}

function isCrowded(d: Dot, dots: Dot[], crossings: ElkPoint[]): boolean {
  return dots.some((o) => o !== d && Math.hypot(o.x - d.x, o.y - d.y) < MIN_DOT_GAP - EPS) || crossings.some((c) => Math.hypot(c.x - d.x, c.y - d.y) < MIN_CROSSING_GAP - EPS);
}

/**
 * Slides one branch of every 4-way junction along its trunk so each net only has T
 * junctions (`offsetOf` gives the slide distance for a net; bigger dots need more room),
 * then slides crowded dots until every dot is MIN_DOT_GAP from the next dot and
 * MIN_CROSSING_GAP from every plain crossing, as far as other wires allow.
 */
export function separateJunctions(layout: ElkGraphOut, offsetOf: (netId: string) => number): ElkGraphOut {
  const edges = cloneEdges(layout.edges);
  const byNet = new Map<string, ElkEdgeOut[]>();
  for (const e of edges) {
    const net = netOfEdge(e.id);
    (byNet.get(net) ?? byNet.set(net, []).get(net)!).push(e);
  }
  const touched = new Set<string>();
  for (const [net, netEdges] of byNet) {
    const offset = offsetOf(net);
    for (let guard = 0; guard < 16; guard++) {
      const segs = segmentsOf(netEdges);
      const others = allSegments(edges);
      const fourWay = segs.flatMap((s) => [s.a, s.b]).filter((p, i, arr) => arr.findIndex((q) => same(p, q)) === i && runsAt(segs, p).size >= 4);
      let moved = false;
      for (const j of fourWay) {
        const deltas = [1, 2, 3].flatMap((m) => [offset * m, -offset * m]);
        if (slideBranch(netEdges, net, j, runsAt(segs, j), deltas, TRUNK_MARGIN, (leg) => clearOfOthers(leg, net, others))) {
          moved = true;
          touched.add(net);
          break;
        }
      }
      if (!moved) break;
    }
  }
  spreadJunctions(edges, byNet, touched);
  for (const [net, netEdges] of byNet) {
    if (touched.has(net) || netEdges.some((e) => (e.junctionPoints ?? []).length > 0)) rebuildJunctions(net, netEdges);
  }
  return { ...layout, edges };
}

/** Slides crowded dots clear of other dots and crossings, one move at a time, while any move helps. */
function spreadJunctions(edges: ElkEdgeOut[], byNet: Map<string, ElkEdgeOut[]>, touched: Set<string>): void {
  const stuck: Dot[] = [];
  for (let guard = 0; guard < 64; guard++) {
    const all = allSegments(edges);
    const dots = [...byNet].flatMap(([net, netEdges]) => dotsOf(net, netEdges));
    const crossings = crossingsOf(all);
    const before = crowding(dots, crossings);
    const crowded = dots.find((d) => isCrowded(d, dots, crossings) && !stuck.some((s) => s.net === d.net && same(s, d)));
    if (!crowded) break;
    const netEdges = byNet.get(crowded.net)!;
    const runs = runsAt(segmentsOf(netEdges), crowded);
    const ok = slideBranch(netEdges, crowded.net, crowded, runs, CROWD_SLIDES, TRUNK_MARGIN, (leg, movedJ) => {
      if (!clearOfOthers(leg, crowded.net, all)) return false;
      const dotsAfter = [...byNet].flatMap(([net, ne]) => dotsOf(net, ne));
      const crossingsAfter = crossingsOf(allSegments(edges));
      const moved = dotsAfter.find((d) => d.net === crowded.net && same(d, movedJ));
      // The moved dot must still be a T of its own net (not slid onto another branch), be clear
      // itself, and leave the drawing less crowded than before.
      if (!moved || runsAt(segmentsOf(netEdges), movedJ).size !== 3) return false;
      return !isCrowded(moved, dotsAfter, crossingsAfter) && crowding(dotsAfter, crossingsAfter) < before;
    });
    if (ok) touched.add(crowded.net);
    else stuck.push(crowded);
  }
}

/**
 * Moves one branch bend at `j` along the trunk by the first delta whose moved leg passes
 * `accept`; the trunk must run `margin` beyond the moved point. The move is applied in
 * place while `accept` runs and reverted when it is refused.
 */
function slideBranch(netEdges: ElkEdgeOut[], _net: string, j: ElkPoint, runs: Map<Dir, number>, deltas: number[], margin: number, accept: (leg: Seg, movedJ: ElkPoint) => boolean): boolean {
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
        for (const d of deltas) {
          const run = runs.get(trunkHorizontal ? (d > 0 ? "E" : "W") : d > 0 ? "S" : "N") ?? 0;
          if (run < Math.abs(d) + margin) continue;
          const movedJ = trunkHorizontal ? { x: j.x + d, y: j.y } : { x: j.x, y: j.y + d };
          const movedNext = trunkHorizontal ? { x: next.x + d, y: next.y } : { x: next.x, y: next.y + d };
          const saved = { jx: pts[k]!.x, jy: pts[k]!.y, nx: pts[k + 1]!.x, ny: pts[k + 1]!.y };
          pts[k]!.x = movedJ.x;
          pts[k]!.y = movedJ.y;
          pts[k + 1]!.x = movedNext.x;
          pts[k + 1]!.y = movedNext.y;
          if (accept({ a: movedJ, b: movedNext }, movedJ)) return true;
          pts[k]!.x = saved.jx;
          pts[k]!.y = saved.jy;
          pts[k + 1]!.x = saved.nx;
          pts[k + 1]!.y = saved.ny;
        }
      }
    }
  }
  return false;
}
