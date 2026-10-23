// Readability checks (accuracy level L3) on a laid-out, rendered module:
// labels fit their symbols, labels do not overlap, every bus carries a width
// label, Fit never zooms past 100 percent, no wire crosses a symbol, parallel
// wires of different nets keep 8 px apart, wire labels keep clear of other
// nets' wires, and every junction dot marks a real T (never a crossing or a 4-way).
// Runs in node: ELK via elkjs, then the pure SVG renderer, then a small walk
// over the markup to recover text boxes in diagram coordinates.
import ELK from "elkjs/lib/main.js";
import type { ModuleView } from "../../src/ir/types";
import { moduleToElk } from "../../webview/layout/toElk";
import type { ElkGraphOut } from "../../webview/layout/types";
import { FIT_MAX_SCALE, NOMINAL_VIEWPORT, WIRE_STROKE } from "../../webview/render/geometry";
import { prepareLayout, renderModule } from "../../webview/render/svg";

type Elk = { layout(g: unknown): Promise<unknown> };
const elk = new (ELK as unknown as new () => Elk)();

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextBox extends Box {
  cls: string;
  text: string;
  /** data-id of the enclosing node or port group */
  owner: string | undefined;
  /** data-net of the label's own net (bus width labels, ripper labels, warning badges) */
  net: string | undefined;
}

/** Minimum distance between parallel wire segments of different nets. */
export const MIN_WIRE_GAP = 8;

export interface LayoutCheck {
  ok: boolean;
  issues: string[];
}

export interface LayoutReport {
  labelsInside: LayoutCheck;
  noOverlap: LayoutCheck;
  busLabels: LayoutCheck;
  fit: LayoutCheck;
  wiresClear: LayoutCheck;
  wireSpacing: LayoutCheck;
  labelsClear: LayoutCheck;
  junctions: LayoutCheck;
  width: number;
  height: number;
  fitScale: number;
  svg: string;
}

/** Font size per text class from webview/styles.css. */
const FONT_SIZE: Record<string, number> = {
  "port-label": 11,
  "pin-label": 9.5,
  "bus-width": 9,
  glyph: 12,
  "glyph small": 9,
  "ripper-label": 8.5,
  label: 11,
  "label title": 11,
  "module-title": 12,
};

function fontSize(cls: string): number {
  return FONT_SIZE[cls] ?? 11;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m?.[1];
}

/** Text boxes in absolute diagram coordinates. */
export function textBoxes(inner: string): TextBox[] {
  const out: TextBox[] = [];
  const stack: { dx: number; dy: number; owner: string | undefined; net: string | undefined }[] = [{ dx: 0, dy: 0, owner: undefined, net: undefined }];
  const re = /<g\b[^>]*>|<\/g>|<text\b[^>]*>(?:<title>[^<]*<\/title>)?([^<]*)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const tag = m[0];
    const top = stack[stack.length - 1]!;
    if (tag.startsWith("</g")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (tag.startsWith("<g")) {
      const t = /translate\(([-\d.]+),([-\d.]+)\)/.exec(attr(tag, "transform") ?? "");
      const id = attr(tag, "data-id");
      stack.push({ dx: top.dx + (t ? Number(t[1]) : 0), dy: top.dy + (t ? Number(t[2]) : 0), owner: id ?? top.owner, net: attr(tag, "data-net") ?? top.net });
      continue;
    }
    const cls = attr(tag, "class") ?? "";
    const net = attr(tag, "data-net") ?? top.net;
    const text = (m[1] ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    if (text.trim() === "") continue;
    const size = fontSize(cls);
    const w = text.length * size * 0.6;
    const h = size;
    const x = Number(attr(tag, "x") ?? 0) + top.dx;
    const y = Number(attr(tag, "y") ?? 0) + top.dy;
    const anchor = attr(tag, "text-anchor") ?? "start";
    const baseline = attr(tag, "dominant-baseline") ?? "alphabetic";
    const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    const topY = baseline === "central" ? y - h / 2 : y - h * 0.8;
    out.push({ x: left, y: topY, w, h, cls, text, owner: top.owner, net });
  }
  return out;
}

function overlaps(a: Box, b: Box, slack = 0.5): boolean {
  return a.x + a.w - slack > b.x + slack && b.x + b.w - slack > a.x + slack && a.y + a.h - slack > b.y + slack && b.y + b.h - slack > a.y + slack;
}

function inside(a: Box, b: Box, tol = 1): boolean {
  return a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;
}

function segmentHitsBox(p: { x: number; y: number }, q: { x: number; y: number }, b: Box): boolean {
  // Liang-Barsky clip of segment p-q against the box interior shrunk by 1px.
  const x0 = b.x + 1;
  const y0 = b.y + 1;
  const x1 = b.x + b.w - 1;
  const y1 = b.y + b.h - 1;
  if (x1 <= x0 || y1 <= y0) return false;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (den: number, num: number): boolean => {
    if (den === 0) return num >= 0; // parallel: inside only when on the inner side
    const t = num / den;
    if (den < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, p.x - x0) && clip(dx, x1 - p.x) && clip(-dy, p.y - y0) && clip(dy, y1 - p.y) && t0 < t1;
}

export async function layoutView(view: ModuleView, options?: Record<string, string>): Promise<ElkGraphOut> {
  return (await elk.layout(moduleToElk(view, options))) as ElkGraphOut;
}

export interface Segment {
  net: string;
  edge: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
}

/** Every straight wire segment of the layout, tagged with its net id. */
export function wireSegments(layout: ElkGraphOut): Segment[] {
  const out: Segment[] = [];
  for (const e of layout.edges) {
    const net = e.id.replace(/^edge:/, "").replace(/:\d+$/, "");
    for (const s of e.sections ?? []) {
      const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        if (a.x === b.x && a.y === b.y) continue;
        out.push({ net, edge: e.id, a, b });
      }
    }
  }
  return out;
}

const EPS = 0.01;

function isH(s: Segment): boolean {
  return Math.abs(s.a.y - s.b.y) < EPS;
}
function isV(s: Segment): boolean {
  return Math.abs(s.a.x - s.b.x) < EPS;
}

/** Distance between two parallel segments whose extents overlap; undefined otherwise. */
function parallelGap(p: Segment, q: Segment): number | undefined {
  if (isH(p) && isH(q)) {
    const over = Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x)) - Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x));
    return over > EPS ? Math.abs(p.a.y - q.a.y) : undefined;
  }
  if (isV(p) && isV(q)) {
    const over = Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y)) - Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y));
    return over > EPS ? Math.abs(p.a.x - q.a.x) : undefined;
  }
  return undefined;
}

/** Point where a horizontal and a vertical segment cross in their interiors (not at an end). */
function crossing(p: Segment, q: Segment): { x: number; y: number } | undefined {
  const h = isH(p) ? p : isH(q) ? q : undefined;
  const v = isV(p) ? p : isV(q) ? q : undefined;
  if (!h || !v || h === v) return undefined;
  const x = v.a.x;
  const y = h.a.y;
  const inH = x > Math.min(h.a.x, h.b.x) + EPS && x < Math.max(h.a.x, h.b.x) - EPS;
  const inV = y > Math.min(v.a.y, v.b.y) + EPS && y < Math.max(v.a.y, v.b.y) - EPS;
  return inH && inV ? { x, y } : undefined;
}

function segmentHitsLabel(s: Segment, box: Box, pad = 1): boolean {
  const x0 = Math.min(s.a.x, s.b.x) - pad;
  const x1 = Math.max(s.a.x, s.b.x) + pad;
  const y0 = Math.min(s.a.y, s.b.y) - pad;
  const y1 = Math.max(s.a.y, s.b.y) + pad;
  return x1 > box.x && x0 < box.x + box.w && y1 > box.y && y0 < box.y + box.h;
}

/** Directions (unit axis vectors) in which wires of one net leave a point. */
function directionsAt(segs: Segment[], pt: { x: number; y: number }): Set<string> {
  const dirs = new Set<string>();
  for (const s of segs) {
    const onSeg = isH(s) ? Math.abs(s.a.y - pt.y) < EPS && pt.x >= Math.min(s.a.x, s.b.x) - EPS && pt.x <= Math.max(s.a.x, s.b.x) + EPS : isV(s) ? Math.abs(s.a.x - pt.x) < EPS && pt.y >= Math.min(s.a.y, s.b.y) - EPS && pt.y <= Math.max(s.a.y, s.b.y) + EPS : false;
    if (!onSeg) continue;
    for (const end of [s.a, s.b]) {
      if (Math.abs(end.x - pt.x) < EPS && Math.abs(end.y - pt.y) < EPS) continue;
      dirs.add(isH(s) ? (end.x > pt.x ? "E" : "W") : end.y > pt.y ? "S" : "N");
    }
  }
  return dirs;
}

/** Junction dots drawn in the markup, with the net they belong to. */
export function junctionDots(inner: string): { net: string; x: number; y: number; r: number }[] {
  const out: { net: string; x: number; y: number; r: number }[] = [];
  const re = /<g class="net[^"]*" data-net="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const net = m[1]!;
    for (const c of (m[2] ?? "").matchAll(/<circle class="junction" cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/g)) {
      out.push({ net, x: Number(c[1]), y: Number(c[2]), r: Number(c[3]) });
    }
  }
  return out;
}

export function checkLayout(view: ModuleView, rawLayout: ElkGraphOut): LayoutReport {
  // The renderer rounds every coordinate and separates 4-way junctions; measure what is drawn.
  const layout = prepareLayout(rawLayout, view);
  const svg = renderModule(view, layout, { frame: true });
  const texts = textBoxes(svg.inner);
  const nodeBox = new Map<string, Box>(layout.children.map((c) => [c.id, { x: c.x, y: c.y, w: c.width, h: c.height }]));
  const kindOf = new Map(view.nodes.map((n) => [n.id, n.kind]));

  // 1. Labels inside their symbol. Ripper and bus labels sit beside wires by design; pin labels of
  //    boxes must still be inside the box.
  const labelsInside: LayoutCheck = { ok: true, issues: [] };
  const frame: Box = { x: 0, y: 0, w: svg.width, h: svg.height };
  for (const t of texts) {
    if (t.cls === "module-title") {
      if (!inside(t, frame)) {
        labelsInside.ok = false;
        labelsInside.issues.push(`module title "${t.text}" spills out of the ${Math.round(frame.w)}x${Math.round(frame.h)} frame`);
      }
      continue;
    }
    if (!t.owner) continue;
    if (t.cls === "ripper-label" || t.cls === "bus-width") continue;
    const box = nodeBox.get(t.owner);
    if (!box) continue;
    if (!inside(t, box)) {
      labelsInside.ok = false;
      labelsInside.issues.push(`"${t.text}" (${t.cls}) spills out of ${t.owner} (${kindOf.get(t.owner) ?? "port"} ${Math.round(box.w)}x${Math.round(box.h)}, text ${Math.round(t.w)}x${Math.round(t.h)})`);
    }
  }

  // 2. No two labels overlap.
  const noOverlap: LayoutCheck = { ok: true, issues: [] };
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!;
      const b = texts[j]!;
      if (overlaps(a, b)) {
        noOverlap.ok = false;
        noOverlap.issues.push(`"${a.text}" (${a.cls}) overlaps "${b.text}" (${b.cls}) near ${Math.round(a.x)},${Math.round(a.y)}`);
      }
    }
  }

  // 2b. Wire labels (bus widths, ripper ranges) must not sit on a symbol or a port chevron.
  for (const t of texts) {
    if (t.cls !== "bus-width" && t.cls !== "ripper-label") continue;
    for (const [id, box] of nodeBox) {
      if (t.cls === "ripper-label" && t.owner === id) continue;
      if (overlaps(t, box, 0)) {
        noOverlap.ok = false;
        noOverlap.issues.push(`"${t.text}" (${t.cls}) sits on ${id} (${kindOf.get(id) ?? "port"})`);
      }
    }
  }

  // 3. Every bus with a drawn edge has a width label.
  const busLabels: LayoutCheck = { ok: true, issues: [] };
  const drawn = new Set(layout.edges.map((e) => e.id.replace(/^edge:/, "").replace(/:\d+$/, "")));
  const rippers = new Set(view.nodes.filter((n) => n.kind === "split" || n.kind === "join").map((n) => n.id));
  for (const net of view.nets) {
    if (net.width <= 1 || !drawn.has(net.id)) continue;
    // A slice out of a split or a part into a join is labelled with its bit range on the ripper.
    const onRipper = (net.driver !== null && rippers.has(net.driver.node)) || (net.sinks.length > 0 && net.sinks.every((x) => x.node.startsWith("join:")));
    if (onRipper) continue;
    const re = new RegExp(`<g class="net bus" data-net="${net.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?<text class="bus-width"[^>]*>${net.width}</text>`);
    if (!re.test(svg.inner)) {
      busLabels.ok = false;
      busLabels.issues.push(`net ${net.name ?? net.id} (${net.width} bits) has no width label`);
    }
  }

  // 4. Fit stays at or below 100 percent.
  const pad = 16;
  const natural = Math.min((NOMINAL_VIEWPORT.width - pad * 2) / Math.max(svg.width, 1), (NOMINAL_VIEWPORT.height - pad * 2) / Math.max(svg.height, 1));
  const fitScale = Math.min(natural, FIT_MAX_SCALE);
  const fit: LayoutCheck = { ok: true, issues: [] };
  if (fitScale > 1) {
    fit.ok = false;
    fit.issues.push(`fit would zoom to ${Math.round(fitScale * 100)}% (cap is ${FIT_MAX_SCALE * 100}%)`);
  }

  // 5. No wire passes through a symbol other than its own endpoints.
  const wiresClear: LayoutCheck = { ok: true, issues: [] };
  for (const e of layout.edges) {
    const ends = new Set([e.sources[0]?.split(".")[0], e.targets[0]?.split(".")[0]].map((s) => s ?? ""));
    // Port ids are "<nodeId>.<pin>", node ids may themselves contain dots; resolve by prefix.
    const endNodes = new Set<string>();
    for (const [id] of nodeBox) for (const ref of [e.sources[0] ?? "", e.targets[0] ?? ""]) if (ref.startsWith(`${id}.`)) endNodes.add(id);
    for (const id of ends) endNodes.add(id);
    for (const s of e.sections ?? []) {
      const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
      for (let i = 0; i + 1 < pts.length; i++) {
        for (const [id, box] of nodeBox) {
          if (endNodes.has(id)) continue;
          if (segmentHitsBox(pts[i]!, pts[i + 1]!, box)) {
            wiresClear.ok = false;
            wiresClear.issues.push(`edge ${e.id} crosses ${id} (${kindOf.get(id) ?? "port"})`);
          }
        }
      }
    }
  }

  // 6. Parallel wires of different nets keep MIN_WIRE_GAP apart (bug 14).
  const segs = wireSegments(layout);
  const wireSpacing: LayoutCheck = { ok: true, issues: [] };
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i]!;
      const q = segs[j]!;
      if (p.net === q.net) continue;
      const gap = parallelGap(p, q);
      if (gap !== undefined && gap < MIN_WIRE_GAP - EPS) {
        wireSpacing.ok = false;
        wireSpacing.issues.push(`${p.net} and ${q.net} run ${Math.round(gap * 10) / 10} px apart near ${Math.round(p.a.x)},${Math.round(p.a.y)}`);
      }
    }
  }

  // 7. Wire labels keep clear of wires that are not their own net (bug 15).
  const labelsClear: LayoutCheck = { ok: true, issues: [] };
  for (const t of texts) {
    if (t.cls !== "bus-width" && t.cls !== "ripper-label" && t.cls !== "warn-badge-text") continue;
    for (const s of segs) {
      if (t.net !== undefined && s.net === t.net) continue;
      if (segmentHitsLabel(s, t)) {
        labelsClear.ok = false;
        labelsClear.issues.push(`"${t.text}" (${t.cls}) sits on a wire of ${s.net} near ${Math.round(t.x)},${Math.round(t.y)}`);
        break;
      }
    }
  }

  // 8. Junction dots: on a real T of their own net, never on a crossing, never 4-way; big enough to see.
  const junctions: LayoutCheck = { ok: true, issues: [] };
  const dots = junctionDots(svg.inner);
  const byNet = new Map<string, Segment[]>();
  for (const s of segs) (byNet.get(s.net) ?? byNet.set(s.net, []).get(s.net)!).push(s);
  for (const d of dots) {
    const dirs = directionsAt(byNet.get(d.net) ?? [], d);
    if (dirs.size < 3) {
      junctions.ok = false;
      junctions.issues.push(`junction dot of ${d.net} at ${d.x},${d.y} joins only ${dirs.size} wire(s)`);
    } else if (dirs.size > 3) {
      junctions.ok = false;
      junctions.issues.push(`4-way junction of ${d.net} at ${d.x},${d.y}`);
    }
    const stroke = (view.nets.find((n) => n.id === d.net)?.width ?? 1) > 1 ? WIRE_STROKE.bus : WIRE_STROKE.single;
    if (d.r < 2.5 * stroke - EPS) {
      junctions.ok = false;
      junctions.issues.push(`junction dot of ${d.net} at ${d.x},${d.y} has radius ${d.r} on a ${stroke} px wire`);
    }
  }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i]!;
      const q = segs[j]!;
      if (p.net === q.net) continue;
      const x = crossing(p, q);
      if (!x) continue;
      const dot = dots.find((d) => Math.abs(d.x - x.x) < d.r && Math.abs(d.y - x.y) < d.r);
      if (dot) {
        junctions.ok = false;
        junctions.issues.push(`dot of ${dot.net} at ${dot.x},${dot.y} sits on the crossing of ${p.net} and ${q.net}`);
      }
    }
  }
  // Two T junctions closer than a dot diameter read as one 4-way.
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      const a = dots[i]!;
      const b = dots[j]!;
      if (a.net === b.net && Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - EPS && (a.x !== b.x || a.y !== b.y)) {
        junctions.ok = false;
        junctions.issues.push(`junction dots of ${a.net} at ${a.x},${a.y} and ${b.x},${b.y} touch`);
      }
    }
  }

  return { labelsInside, noOverlap, busLabels, fit, wiresClear, wireSpacing, labelsClear, junctions, width: svg.width, height: svg.height, fitScale, svg: svg.inner };
}
