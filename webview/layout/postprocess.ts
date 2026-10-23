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

/** Coordinates are whole pixels after roundLayout; EPS-equal values share a key. */
const coord = (v: number): number => Math.round(v * 100);
const pointKey = (p: ElkPoint): number => coord(p.x) * 4_000_037 + coord(p.y);

/** Segments bucketed by the coordinate they run along, so a point or a range finds its few candidates. */
class SegIndex {
  /** Horizontal segments by y. */
  readonly byY = new Map<number, NetSeg[]>();
  /** Vertical segments by x. */
  readonly byX = new Map<number, NetSeg[]>();
  private xs: number[] | undefined;
  private ys: number[] | undefined;

  constructor(segs: readonly NetSeg[]) {
    for (const sg of segs) this.add(sg);
  }

  add(sg: NetSeg): void {
    const horizontal = Math.abs(sg.a.y - sg.b.y) < EPS;
    const map = horizontal ? this.byY : this.byX;
    const k = coord(horizontal ? sg.a.y : sg.a.x);
    const list = map.get(k);
    if (list) list.push(sg);
    else {
      map.set(k, [sg]);
      if (horizontal) this.ys = undefined;
      else this.xs = undefined;
    }
  }

  /** Removes the segment with the same ends and net, if present. */
  remove(sg: NetSeg): void {
    const horizontal = Math.abs(sg.a.y - sg.b.y) < EPS;
    const map = horizontal ? this.byY : this.byX;
    const k = coord(horizontal ? sg.a.y : sg.a.x);
    const list = map.get(k);
    if (!list) return;
    const key = segKey(sg);
    const i = list.findIndex((o) => o.net === sg.net && segKey(o) === key);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) {
      map.delete(k);
      if (horizontal) this.ys = undefined;
      else this.xs = undefined;
    }
  }

  /** Segments that pass through `pt` (either orientation). */
  at(pt: ElkPoint): NetSeg[] {
    return [...(this.byY.get(coord(pt.y)) ?? []), ...(this.byX.get(coord(pt.x)) ?? [])];
  }

  /** Calls `fn` for every vertical segment whose x lies strictly inside (lo, hi). */
  eachVerticalBetween(lo: number, hi: number, fn: (s: NetSeg) => void): void {
    this.xs ??= [...this.byX.keys()].sort((a, b) => a - b);
    this.range(this.xs, this.byX, lo, hi, fn);
  }

  /** Calls `fn` for every horizontal segment whose y lies strictly inside (lo, hi). */
  eachHorizontalBetween(lo: number, hi: number, fn: (s: NetSeg) => void): void {
    this.ys ??= [...this.byY.keys()].sort((a, b) => a - b);
    this.range(this.ys, this.byY, lo, hi, fn);
  }

  private range(keys: number[], map: Map<number, NetSeg[]>, lo: number, hi: number, fn: (s: NetSeg) => void): void {
    let i = lowerBound(keys, coord(lo + EPS) + 1);
    for (; i < keys.length && keys[i]! < coord(hi - EPS); i++) for (const s of map.get(keys[i]!)!) fn(s);
  }
}

function lowerBound(keys: number[], v: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Directions in which wires leave a point, with the longest run available in each. */
function runsAtIndexed(index: SegIndex, pt: ElkPoint): Map<Dir, number> {
  const runs = new Map<Dir, number>();
  for (const s of index.at(pt)) {
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

interface Entry {
  p: ElkPoint;
  /** How many records (crossing pairs, or dots) sit at this point. */
  n: number;
}

/**
 * Distinct points with a count of the records that make them, bucketed in square cells so
 * "anything within `gap`" scans nine cells. Records can be removed again, so the set follows
 * accepted moves instead of being rebuilt.
 */
class PointSet {
  private readonly entries = new Map<number, Entry>();
  private readonly cells = new Map<number, Set<Entry>>();
  constructor(
    points: readonly ElkPoint[],
    private readonly cell: number,
  ) {
    for (const p of points) this.add(p);
  }
  private cellKey(p: ElkPoint): number {
    return Math.floor(p.x / this.cell) * 1_000_003 + Math.floor(p.y / this.cell);
  }
  add(p: ElkPoint): void {
    const k = pointKey(p);
    const e = this.entries.get(k);
    if (e) {
      e.n++;
      return;
    }
    const entry = { p: { x: p.x, y: p.y }, n: 1 };
    this.entries.set(k, entry);
    const c = this.cellKey(p);
    const set = this.cells.get(c);
    if (set) set.add(entry);
    else this.cells.set(c, new Set([entry]));
  }
  remove(p: ElkPoint): void {
    const k = pointKey(p);
    const e = this.entries.get(k);
    if (!e) return;
    if (--e.n > 0) return;
    this.entries.delete(k);
    this.cells.get(this.cellKey(p))?.delete(e);
  }
  /** True when records other than the `exclude` count at that point remain. */
  has(p: ElkPoint, exclude?: ReadonlyMap<number, number>): boolean {
    const e = this.entries.get(pointKey(p));
    return e !== undefined && e.n - (exclude?.get(pointKey(p)) ?? 0) > 0;
  }
  /** Distinct points strictly closer than `gap` to `p` (not `p` itself), ignoring records counted in `exclude`. */
  countWithin(p: ElkPoint, gap: number, exclude?: ReadonlyMap<number, number>): number {
    let n = 0;
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const e of this.cells.get((cx + dx) * 1_000_003 + (cy + dy)) ?? []) {
          if (exclude && e.n - (exclude.get(pointKey(e.p)) ?? 0) <= 0) continue;
          if (!same(e.p, p) && Math.hypot(e.p.x - p.x, e.p.y - p.y) < gap - EPS) n++;
        }
      }
    }
    return n;
  }
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

/** Every point of a net where three or more wires meet. */
function dotsOf(net: string, netEdges: ElkEdgeOut[]): Dot[] {
  const index = new SegIndex(segmentsOf(netEdges).map((sg) => ({ ...sg, net })));
  const seen = new Map<number, ElkPoint>();
  for (const e of netEdges) for (const pts of pointsOf(e)) for (const p of pts) if (!seen.has(pointKey(p))) seen.set(pointKey(p), p);
  const out: Dot[] = [];
  for (const p of seen.values()) if (runsAtIndexed(index, p).size >= 3) out.push({ net, x: p.x, y: p.y });
  return out;
}

/** Junction dots recomputed from the geometry. */
function rebuildJunctions(net: string, netEdges: ElkEdgeOut[]): void {
  const dots = dotsOf(net, netEdges).map((d) => ({ x: d.x, y: d.y }));
  netEdges.forEach((e, i) => {
    if (i === 0) e.junctionPoints = dots;
    else delete e.junctionPoints;
  });
}

interface Crossing extends ElkPoint {
  netA: string;
  netB: string;
  /** Keys of the horizontal (A) and vertical (B) segments that cross. */
  keyA: string;
  keyB: string;
}

/** Interior crossings between `segs` and the segments in `others` (other nets only). */
function crossingsAgainst(segs: readonly NetSeg[], others: SegIndex): Crossing[] {
  const out: Crossing[] = [];
  for (const sg of segs) {
    if (Math.abs(sg.a.y - sg.b.y) < EPS) {
      const y = sg.a.y;
      others.eachVerticalBetween(Math.min(sg.a.x, sg.b.x), Math.max(sg.a.x, sg.b.x), (v) => {
        if (v.net === sg.net) return;
        if (y <= Math.min(v.a.y, v.b.y) + EPS || y >= Math.max(v.a.y, v.b.y) - EPS) return;
        out.push({ x: v.a.x, y, netA: sg.net, netB: v.net, keyA: segKey(sg), keyB: segKey(v) });
      });
    } else {
      const x = sg.a.x;
      others.eachHorizontalBetween(Math.min(sg.a.y, sg.b.y), Math.max(sg.a.y, sg.b.y), (h) => {
        if (h.net === sg.net) return;
        if (x <= Math.min(h.a.x, h.b.x) + EPS || x >= Math.max(h.a.x, h.b.x) - EPS) return;
        out.push({ x, y: h.a.y, netA: h.net, netB: sg.net, keyA: segKey(h), keyB: segKey(sg) });
      });
    }
  }
  return out;
}

/** Distinct points where wires of different nets cross in their interiors (for the renderer). */
export function crossingPoints(segs: readonly { net: string; a: ElkPoint; b: ElkPoint }[]): ElkPoint[] {
  const index = new SegIndex(segs);
  const seen = new Set<number>();
  const out: ElkPoint[] = [];
  for (const sg of segs) {
    if (Math.abs(sg.a.y - sg.b.y) >= EPS) continue; // each pair once, from its horizontal
    for (const r of crossingsAgainst([sg], index)) {
      const k = pointKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ x: r.x, y: r.y });
    }
  }
  return out;
}

/** clearOfOthers over an index: only segments within CLEARANCE of the leg are looked at. */
function clearOfOthersIndexed(seg: Seg, net: string, others: SegIndex): boolean {
  const vertical = Math.abs(seg.a.x - seg.b.x) < EPS;
  const lo = vertical ? Math.min(seg.a.y, seg.b.y) : Math.min(seg.a.x, seg.b.x);
  const hi = vertical ? Math.max(seg.a.y, seg.b.y) : Math.max(seg.a.x, seg.b.x);
  const at = vertical ? seg.a.x : seg.a.y;
  let clear = true;
  const parallel = (o: NetSeg): void => {
    if (!clear || o.net === net) return;
    const oLo = vertical ? Math.min(o.a.y, o.b.y) : Math.min(o.a.x, o.b.x);
    const oHi = vertical ? Math.max(o.a.y, o.b.y) : Math.max(o.a.x, o.b.x);
    if (Math.min(hi, oHi) - Math.max(lo, oLo) > -CLEARANCE) clear = false;
  };
  if (vertical) others.eachVerticalBetween(at - CLEARANCE, at + CLEARANCE, parallel);
  else others.eachHorizontalBetween(at - CLEARANCE, at + CLEARANCE, parallel);
  if (!clear) return false;
  // A perpendicular wire of another net must not pass through either end of the moved leg.
  for (const end of [seg.a, seg.b]) {
    const endAlong = vertical ? end.y : end.x;
    const endAcross = vertical ? end.x : end.y;
    const perpendicular = (o: NetSeg): void => {
      if (!clear || o.net === net) return;
      const oLo = vertical ? Math.min(o.a.x, o.b.x) : Math.min(o.a.y, o.b.y);
      const oHi = vertical ? Math.max(o.a.x, o.b.x) : Math.max(o.a.y, o.b.y);
      if (endAlong > oLo - CLEARANCE && endAlong < oHi + CLEARANCE) clear = false;
    };
    if (vertical) others.eachHorizontalBetween(endAcross - CLEARANCE, endAcross + CLEARANCE, perpendicular);
    else others.eachVerticalBetween(endAcross - CLEARANCE, endAcross + CLEARANCE, perpendicular);
    if (!clear) return false;
  }
  return true;
}

const tooClose = (a: ElkPoint, b: ElkPoint, gap: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) < gap - EPS;

const segKey = (sg: Seg): string => `${pointKey(sg.a)}|${pointKey(sg.b)}`;

/** True when `pt` lies on the segment (same test as runsAtIndexed). */
function onSegment(sg: Seg, pt: ElkPoint): boolean {
  const horizontal = Math.abs(sg.a.y - sg.b.y) < EPS;
  return horizontal
    ? Math.abs(sg.a.y - pt.y) < EPS && pt.x >= Math.min(sg.a.x, sg.b.x) - EPS && pt.x <= Math.max(sg.a.x, sg.b.x) + EPS
    : Math.abs(sg.a.x - pt.x) < EPS && pt.y >= Math.min(sg.a.y, sg.b.y) - EPS && pt.y <= Math.max(sg.a.y, sg.b.y) + EPS;
}

/** Every distinct point of a net's wires with how many section points sit there. */
function pointCounts(netEdges: ElkEdgeOut[]): Map<number, { p: ElkPoint; n: number }> {
  const out = new Map<number, { p: ElkPoint; n: number }>();
  for (const e of netEdges) {
    for (const pts of pointsOf(e)) {
      for (const p of pts) {
        const k = pointKey(p);
        const e2 = out.get(k);
        if (e2) e2.n++;
        else out.set(k, { p, n: 1 });
      }
    }
  }
  return out;
}

/** Runs at `pt` over `index` with the replaced segments taken out and the added ones put in. */
function runsAfter(index: SegIndex, pt: ElkPoint, change: Change): Map<Dir, number> {
  const replaced = new Set(change.replaced.map(segKey));
  const runs = new Map<Dir, number>();
  const consider = (s: Seg): void => {
    const horizontal = Math.abs(s.a.y - s.b.y) < EPS;
    if (!onSegment(s, pt)) return;
    for (const end of [s.a, s.b]) {
      if (same(end, pt)) continue;
      const dir: Dir = horizontal ? (end.x > pt.x ? "E" : "W") : end.y > pt.y ? "S" : "N";
      const len = horizontal ? Math.abs(end.x - pt.x) : Math.abs(end.y - pt.y);
      runs.set(dir, Math.max(runs.get(dir) ?? 0, len));
    }
  };
  for (const s of index.at(pt)) if (!replaced.has(segKey(s))) consider(s);
  for (const s of change.added) if (!same(s.a, s.b)) consider(s);
  return runs;
}

/**
 * The net's junction dots after a slide, from the dots before it: only points on a replaced
 * or added segment can change, so only those are re-examined.
 */
function dotsAfter(net: string, index: SegIndex, points: ReadonlyMap<number, { p: ElkPoint; n: number }>, before: readonly Dot[], change: Change): Dot[] {
  const touched = [...change.replaced, ...change.added].filter((sg) => !same(sg.a, sg.b));
  const candidates = new Map<number, ElkPoint>();
  for (const { p } of points.values()) if (touched.some((sg) => onSegment(sg, p))) candidates.set(pointKey(p), p);
  for (const sg of change.replaced) for (const p of [sg.a, sg.b]) candidates.set(pointKey(p), p);
  for (const sg of change.added) for (const p of [sg.a, sg.b]) candidates.set(pointKey(p), p);
  // The moved section no longer sits at the old bend and its leg end, and now sits at the new ones.
  const adjust = new Map<number, number>();
  const bump = (p: ElkPoint, d: number): void => {
    adjust.set(pointKey(p), (adjust.get(pointKey(p)) ?? 0) + d);
  };
  bump(change.replaced[1]!.a, -1);
  bump(change.replaced[1]!.b, -1);
  bump(change.added[1]!.a, 1);
  bump(change.added[1]!.b, 1);
  const present = (k: number): boolean => (points.get(k)?.n ?? 0) + (adjust.get(k) ?? 0) > 0;
  const out: Dot[] = before.filter((d) => !candidates.has(pointKey(d)));
  for (const [k, p] of candidates) if (present(k) && runsAfter(index, p, change).size >= 3) out.push({ net, x: p.x, y: p.y });
  return out;
}

function countAt(records: readonly ElkPoint[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of records) out.set(pointKey(r), (out.get(pointKey(r)) ?? 0) + 1);
  return out;
}

/** Pairs within `gap` between every point of `xs` and every point of `ys` (plain loops; both lists are small). */
function pairs(xs: readonly ElkPoint[], ys: readonly ElkPoint[], gap: number): number {
  let n = 0;
  for (const x of xs) for (const y of ys) if (tooClose(x, y, gap)) n++;
  return n;
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
      const index = new SegIndex(segs.map((sg) => ({ ...sg, net })));
      const seen = new Set<number>();
      const fourWay: ElkPoint[] = [];
      for (const sg of segs) for (const p of [sg.a, sg.b]) if (!seen.has(pointKey(p)) && seen.add(pointKey(p)) && runsAtIndexed(index, p).size >= 4) fourWay.push(p);
      if (fourWay.length === 0) break;
      const others = new SegIndex(allSegments(edges));
      let moved = false;
      for (const j of fourWay) {
        const deltas = [1, 2, 3].flatMap((m) => [offset * m, -offset * m]);
        if (slideBranch(netEdges, net, j, runsAtIndexed(index, j), deltas, TRUNK_MARGIN, (leg) => clearOfOthersIndexed(leg, net, others))) {
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

/**
 * Slides crowded dots clear of other dots and crossings, one move at a time, while any move
 * helps: a move is accepted when the number of dot pairs under MIN_DOT_GAP plus dot-crossing
 * pairs under MIN_CROSSING_GAP goes down. Every index (segments, dots, crossings, the
 * crossings per segment and which dots are crowded) is built once and follows each accepted
 * move, and an attempt scores only what it changes (one or two dots and the crossings of
 * three segments), which keeps a 100-node diagram inside the render budget.
 */
function spreadJunctions(edges: ElkEdgeOut[], byNet: Map<string, ElkEdgeOut[]>, touched: Set<string>): void {
  const stuck: Dot[] = [];
  const dotsByNet = new Map<string, Dot[]>();
  for (const [net, netEdges] of byNet) dotsByNet.set(net, dotsOf(net, netEdges));
  const index = new SegIndex(allSegments(edges));
  // Crossings per segment per net; each record sits under both of its segments and is
  // counted once in `crossings` (from its horizontal segment).
  const bySeg = new Map<string, Map<string, Crossing[]>>();
  const entry = (net: string, key: string): Crossing[] => {
    const m = bySeg.get(net) ?? bySeg.set(net, new Map()).get(net)!;
    return m.get(key) ?? m.set(key, []).get(key)!;
  };
  const crossings = new PointSet([], MIN_CROSSING_GAP);
  for (const list of index.byY.values()) {
    for (const h of list) {
      for (const r of crossingsAgainst([h], index)) {
        crossings.add(r);
        entry(r.netA, r.keyA).push(r);
        entry(r.netB, r.keyB).push(r);
      }
    }
  }
  for (const list of index.byX.values()) for (const v of list) entry(v.net, segKey(v));
  const dotSet = new PointSet([...dotsByNet.values()].flat(), MIN_DOT_GAP);
  const none = new Map<number, number>();
  const crowdedNow = (d: Dot): boolean => dotSet.countWithin(d, MIN_DOT_GAP) > 0 || crossings.countWithin(d, MIN_CROSSING_GAP, none) > 0;
  const flags = new Map<Dot, boolean>();
  const near = (d: ElkPoint, pts: readonly ElkPoint[]): boolean => pts.some((p) => Math.hypot(p.x - d.x, p.y - d.y) < Math.max(MIN_DOT_GAP, MIN_CROSSING_GAP) + 1);
  for (let guard = 0; guard < 64; guard++) {
    let crowded: Dot | undefined;
    for (const list of dotsByNet.values()) {
      for (const d of list) {
        let f = flags.get(d);
        if (f === undefined) flags.set(d, (f = crowdedNow(d)));
        if (f && !stuck.some((st) => st.net === d.net && same(st, d))) {
          crowded = d;
          break;
        }
      }
      if (crowded) break;
    }
    if (!crowded) break;
    const net = crowded.net;
    const netEdges = byNet.get(net)!;
    const mineBySeg = bySeg.get(net) ?? new Map<string, Crossing[]>();
    const mineAll = [...mineBySeg.values()].flat();
    const mineCount = countAt(mineAll);
    // Crossing points only this net makes (no other pair of nets crosses there).
    const ownBefore = new PointSet([], MIN_CROSSING_GAP);
    const ownKeys = new Set<number>();
    for (const r of mineAll) {
      if (ownKeys.has(pointKey(r)) || crossings.has(r, mineCount)) continue;
      ownKeys.add(pointKey(r));
      ownBefore.add(r);
    }
    const dotsBefore = dotsByNet.get(net)!;
    const dotExclude = countAt(dotsBefore);
    const netIndex = new SegIndex(segmentsOf(netEdges).map((sg) => ({ ...sg, net })));
    const points = pointCounts(netEdges);
    const runs = runsAtIndexed(netIndex, crowded);
    let accepted: { netDots: Dot[]; removedDots: Dot[]; addedDots: Dot[]; replaced: Crossing[]; addedBySeg: Map<string, Crossing[]>; vanished: ElkPoint[]; appeared: ElkPoint[]; change: Change } | undefined;
    const ok = slideBranch(netEdges, net, crowded, runs, CROWD_SLIDES, TRUNK_MARGIN, (leg, movedJ, change) => {
      if (!clearOfOthersIndexed(leg, net, index)) return false;
      const dotsAfterMove = dotsAfter(net, netIndex, points, dotsBefore, change);
      const moved = dotsAfterMove.find((d) => same(d, movedJ));
      // The moved dot must still be a T of its own net (not slid onto another branch).
      if (!moved || runsAfter(netIndex, movedJ, change).size !== 3) return false;
      const replacedKeys = new Set(change.replaced.map(segKey));
      const replaced = [...mineBySeg].filter(([k]) => replacedKeys.has(k)).flatMap(([, v]) => v);
      const addedBySeg = new Map<string, Crossing[]>();
      for (const sg of change.added) if (!same(sg.a, sg.b)) addedBySeg.set(segKey(sg), crossingsAgainst([{ ...sg, net }], index));
      const added = [...addedBySeg.values()].flat();
      // Dots that leave and arrive.
      const afterKeys = new Set(dotsAfterMove.map(pointKey));
      const beforeKeys = new Set(dotsBefore.map(pointKey));
      const removedDots = dotsBefore.filter((d) => !afterKeys.has(pointKey(d)));
      const addedDots = dotsAfterMove.filter((d) => !beforeKeys.has(pointKey(d)));
      const kept = dotsAfterMove.filter((d) => beforeKeys.has(pointKey(d)));
      // Own crossing points that vanish and appear.
      const removedAt = countAt(replaced);
      const addedAt = countAt(added);
      const changedKeys = new Set([...removedAt.keys(), ...addedAt.keys()]);
      const vanished: ElkPoint[] = [];
      const appeared: ElkPoint[] = [];
      for (const k of changedKeys) {
        const sample = replaced.find((r) => pointKey(r) === k) ?? added.find((r) => pointKey(r) === k)!;
        if (crossings.has(sample, mineCount)) continue;
        const was = (mineCount.get(k) ?? 0) > 0;
        const is = (mineCount.get(k) ?? 0) - (removedAt.get(k) ?? 0) + (addedAt.get(k) ?? 0) > 0;
        if (was && !is) vanished.push(sample);
        if (!was && is) appeared.push(sample);
      }
      // The moved dot itself must be clear of every dot and crossing after the move.
      const dotsNearMoved = dotSet.countWithin(moved, MIN_DOT_GAP, dotExclude) + pairs([moved], dotsAfterMove.filter((d) => d !== moved), MIN_DOT_GAP);
      const crossingsNearMoved = crossings.countWithin(moved, MIN_CROSSING_GAP, none) - pairs([moved], vanished, MIN_CROSSING_GAP) + pairs([moved], appeared, MIN_CROSSING_GAP);
      if (dotsNearMoved > 0 || crossingsNearMoved > 0) return false;
      // Change in the crowding count, from what moved: dots that left or arrived, and the net's
      // own crossing points that vanished or appeared.
      let delta = 0;
      for (const a of addedDots) delta += pairs([a], kept, MIN_DOT_GAP) + dotSet.countWithin(a, MIN_DOT_GAP, dotExclude);
      delta += pairs(addedDots, addedDots, MIN_DOT_GAP) / 2;
      for (const r of removedDots) delta -= pairs([r], kept, MIN_DOT_GAP) + dotSet.countWithin(r, MIN_DOT_GAP, dotExclude);
      delta -= pairs(removedDots, removedDots, MIN_DOT_GAP) / 2;
      for (const a of addedDots) delta += ownBefore.countWithin(a, MIN_CROSSING_GAP) - pairs([a], vanished, MIN_CROSSING_GAP) + pairs([a], appeared, MIN_CROSSING_GAP);
      for (const r of removedDots) delta -= ownBefore.countWithin(r, MIN_CROSSING_GAP);
      delta += pairs(kept, appeared, MIN_CROSSING_GAP) - pairs(kept, vanished, MIN_CROSSING_GAP);
      for (const c of appeared) delta += dotSet.countWithin(c, MIN_CROSSING_GAP, dotExclude);
      for (const c of vanished) delta -= dotSet.countWithin(c, MIN_CROSSING_GAP, dotExclude);
      if (delta >= 0) return false;
      accepted = { netDots: dotsAfterMove, removedDots, addedDots, replaced, addedBySeg, vanished, appeared, change };
      return true;
    });
    if (ok && accepted) {
      touched.add(net);
      const { change, replaced, addedBySeg, removedDots, addedDots, vanished, appeared } = accepted;
      dotsByNet.set(net, accepted.netDots);
      // Segments: the three replaced go out of the index, the three added go in.
      for (const sg of change.replaced) if (!same(sg.a, sg.b)) index.remove({ ...sg, net });
      for (const sg of change.added) if (!same(sg.a, sg.b)) index.add({ ...sg, net });
      // Crossings: records of the replaced segments leave both nets' tables and the point set.
      const replacedKeys = new Set(change.replaced.map(segKey));
      for (const r of replaced) {
        crossings.remove(r);
        const other = r.netA === net ? r.netB : r.netA;
        const otherKey = r.netA === net ? r.keyB : r.keyA;
        const list = bySeg.get(other)?.get(otherKey);
        if (list) list.splice(list.indexOf(r), 1);
      }
      const mine = bySeg.get(net) ?? bySeg.set(net, new Map()).get(net)!;
      for (const k of replacedKeys) mine.delete(k);
      for (const [k, list] of addedBySeg) {
        mine.set(k, list);
        for (const r of list) {
          crossings.add(r);
          entry(r.netA === net ? r.netB : r.netA, r.netA === net ? r.keyB : r.keyA).push(r);
        }
      }
      // Dots: the point set and the crowded flags of every dot near a change.
      for (const d of removedDots) dotSet.remove(d);
      for (const d of addedDots) dotSet.add(d);
      const changed = [...removedDots, ...addedDots, ...vanished, ...appeared];
      for (const list of dotsByNet.values()) for (const d of list) if (near(d, changed)) flags.delete(d);
    } else stuck.push(crowded);
  }
}

/** Segments a slide replaces and the ones it adds, so callers can update their indexes in place. */
interface Change {
  replaced: Seg[];
  added: Seg[];
}

function slideBranch(netEdges: ElkEdgeOut[], _net: string, j: ElkPoint, runs: Map<Dir, number>, deltas: number[], margin: number, accept: (leg: Seg, movedJ: ElkPoint, change: Change) => boolean): boolean {
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
          const after = { ...pts[k + 2]! };
          const change: Change = {
            replaced: [{ a: { ...prev }, b: { ...j } }, { a: { ...j }, b: { ...next } }, { a: { ...next }, b: after }],
            added: [{ a: { ...prev }, b: movedJ }, { a: movedJ, b: movedNext }, { a: movedNext, b: after }],
          };
          pts[k]!.x = movedJ.x;
          pts[k]!.y = movedJ.y;
          pts[k + 1]!.x = movedNext.x;
          pts[k + 1]!.y = movedNext.y;
          if (accept({ a: movedJ, b: movedNext }, movedJ, change)) return true;
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
