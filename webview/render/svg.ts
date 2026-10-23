// Pure SVG string renderer: ELK layout + ModuleView -> SVG markup.
// No DOM access so it can be unit tested in node and reused for export.
import type { ModuleView, Net, Node, Pin, Port } from "../../src/ir/types";
import type { ElkEdgeOut, ElkGraphOut, ElkNodeOut, ElkPoint, ElkPortOut } from "../layout/types";
import { elkPortId, portNodeId } from "../layout/toElk";
import { junctionOffset, netOfEdge, separateJunctions } from "../layout/postprocess";
import { expandLogicalGates } from "./logical";
import { netTooltip, nodeTooltip, portTooltip, TIP, type SourceLines } from "./tooltips";
import { symbolMarkup } from "./symbols";
import { frameMinWidth, junctionRadius } from "./geometry";

export interface RenderOptions {
  /** Show the module frame and title */
  frame?: boolean;
  /** Stale (last good) rendering gets a class for dimming */
  stale?: boolean;
  /** Lines of the source text, so tooltips can quote the line an element came from */
  sourceLines?: readonly string[];
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export interface RenderedSvg {
  /** Inner markup to place inside the pan/zoom group */
  inner: string;
  width: number;
  height: number;
}

interface Indexed {
  nodes: Map<string, ElkNodeOut>;
  ports: Map<string, { node: ElkNodeOut; port: ElkPortOut }>;
}

function index(layout: ElkGraphOut): Indexed {
  const nodes = new Map<string, ElkNodeOut>();
  const ports = new Map<string, { node: ElkNodeOut; port: ElkPortOut }>();
  for (const n of layout.children) {
    nodes.set(n.id, n);
    for (const p of n.ports ?? []) ports.set(p.id, { node: n, port: p });
  }
  return { nodes, ports };
}

function srcAttr(src: { line: number; column: number; endLine: number; endColumn: number }[]): string {
  const s = src[0];
  if (!s) return "";
  const all = src.map((r) => `${r.line}:${r.column}:${r.endLine}:${r.endColumn}`).join(";");
  return ` data-line="${s.line}" data-column="${s.column}" data-end-line="${s.endLine}" data-end-column="${s.endColumn}" data-src="${all}"`;
}

/** Pentagon pointing in the flow direction; inout is a hexagon. */
export function portShapePath(direction: Port["direction"], w: number, h: number): string {
  return direction === "inout"
    ? `M8,0 H${fmt(w - 8)} L${fmt(w)},${fmt(h / 2)} L${fmt(w - 8)},${fmt(h)} H8 L0,${fmt(h / 2)} Z`
    : direction === "input"
      ? `M0,0 H${fmt(w - 8)} L${fmt(w)},${fmt(h / 2)} L${fmt(w - 8)},${fmt(h)} H0 Z`
      : `M8,0 H${fmt(w)} V${fmt(h)} H8 L0,${fmt(h / 2)} Z`;
}

function renderPortNode(port: Port, n: ElkNodeOut, lines: SourceLines): string {
  const isInput = port.direction === "input";
  const label = port.width > 1 ? `${port.name}${port.range ?? `[${port.width - 1}:0]`}` : port.name;
  const w = n.width;
  const h = n.height;
  const shape = portShapePath(port.direction, w, h);
  const cls = `port port-${port.direction}${port.width > 1 ? " bus" : ""}${port.ghost ? ` ghost ghost-${port.ghost}` : ""}${port.tentative ? " tentative" : ""}`;
  return (
    `<g class="${cls}" data-port="${esc(port.name)}" data-id="${esc(portNodeId(port.name))}"${port.ghost ? ` data-ghost="${port.ghost}"` : ""}${srcAttr(port.src)} transform="translate(${fmt(n.x)},${fmt(n.y)})">` +
    `<path class="port-shape" d="${shape}"/>` +
    `<text class="port-label" x="${fmt(isInput ? 6 : w - 6)}" y="${fmt(h / 2)}" text-anchor="${isInput ? "start" : "end"}" dominant-baseline="central">${esc(label)}</text>` +
    `<title>${esc(portTooltip(port, label, lines))}</title>` +
    `</g>`
  );
}

function pinPositions(node: Node, n: ElkNodeOut): Map<string, { x: number; y: number; pin: Pin }> {
  const out = new Map<string, { x: number; y: number; pin: Pin }>();
  const byId = new Map((n.ports ?? []).map((p) => [p.id, p] as const));
  for (const pin of node.pins) {
    const ep = byId.get(elkPortId(node.id, pin.id));
    if (ep) out.set(pin.id, { x: ep.x, y: ep.y, pin });
  }
  return out;
}

function renderNode(node: Node, n: ElkNodeOut, lines: SourceLines): string {
  const pins = pinPositions(node, n);
  const body = symbolMarkup(node, n.width, n.height, pins);
  const cls = `node node-${node.kind}${node.op ? ` op-${node.op}` : ""}`;
  const tip = nodeTooltip(node, lines);
  return (
    `<g class="${cls}" data-id="${esc(node.id)}" data-kind="${node.kind}"${node.op ? ` data-op="${esc(node.op)}"` : ""}${node.drillTarget ? ` data-drill="${esc(node.drillTarget)}"` : ""}${srcAttr(node.src)} transform="translate(${fmt(n.x)},${fmt(n.y)})">` +
    body +
    `<title>${esc(tip)}</title>` +
    `</g>`
  );
}

/** Tooltip text of a node without source lines (kept for callers that have no text). */
export function tooltip(node: Node): string {
  return nodeTooltip(node, undefined);
}

function edgePath(e: ElkEdgeOut): string {
  const parts: string[] = [];
  for (const s of e.sections ?? []) {
    parts.push(`M${fmt(s.startPoint.x)},${fmt(s.startPoint.y)}`);
    for (const b of s.bendPoints ?? []) parts.push(`L${fmt(b.x)},${fmt(b.y)}`);
    parts.push(`L${fmt(s.endPoint.x)},${fmt(s.endPoint.y)}`);
  }
  return parts.join(" ");
}

interface BusLabel {
  x: number;
  y: number;
  anchor: "start" | "end";
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a wire label must keep clear of: other nets' wires, every symbol, and its own net's dots. */
export interface Avoid {
  segs: { net: string; a: ElkPoint; b: ElkPoint }[];
  boxes: Box[];
  dots: { net: string; x: number; y: number; r: number }[];
}

const BUS_WIDTH_CHAR = 9 * 0.6;

function boxesTouch(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Box a width label (slash plus number) or a warning badge occupies around its anchor point. */
function labelBox(p: BusLabel, textW: number): Box {
  return p.anchor === "start" ? { x: p.x - 4, y: p.y - 11, w: 8 + textW, h: 15 } : { x: p.x - 4 - textW, y: p.y - 11, w: 8 + textW, h: 15 };
}

function isClear(box: Box, net: string, avoid: Avoid): boolean {
  for (const s of avoid.segs) {
    if (s.net === net) continue;
    const r: Box = { x: Math.min(s.a.x, s.b.x) - 1, y: Math.min(s.a.y, s.b.y) - 1, w: Math.abs(s.a.x - s.b.x) + 2, h: Math.abs(s.a.y - s.b.y) + 2 };
    if (boxesTouch(box, r)) return false;
  }
  for (const b of avoid.boxes) if (boxesTouch(box, b)) return false;
  for (const d of avoid.dots) if (d.net === net && boxesTouch(box, { x: d.x - d.r, y: d.y - d.r, w: 2 * d.r, h: 2 * d.r })) return false;
  return true;
}

/**
 * Where the width label goes: the first candidate along the wire that keeps clear of other
 * nets, symbols and junction dots. Candidates run along the longest segment first. A wire
 * that leaves a ripper carries the range label at that end, so the width goes near the
 * other end instead (12 px before a pin, 20 px before a port chevron), anchored away from it.
 */
function busLabelPos(e: ElkEdgeOut, nearEnd: "start" | "end" | "middle", endIsPort: boolean, net: string, textW: number, avoid: Avoid): BusLabel | undefined {
  const s = e.sections?.[0];
  if (!s) return undefined;
  const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
  const segs: { a: ElkPoint; b: ElkPoint; len: number }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    segs.push({ a, b, len: Math.hypot(b.x - a.x, b.y - a.y) });
  }
  if (segs.length === 0) return undefined;
  const gap = endIsPort ? 20 : 12;
  const total = segs.reduce((a, x) => a + x.len, 0);
  const along = (seg: { a: { x: number; y: number }; b: { x: number; y: number }; len: number }, t: number): { x: number; y: number } =>
    seg.len <= 0 ? { x: seg.a.x, y: seg.a.y } : { x: seg.a.x + ((seg.b.x - seg.a.x) / seg.len) * t, y: seg.a.y + ((seg.b.y - seg.a.y) / seg.len) * t };
  // Walk the polyline from one end by a distance, whatever the segment structure.
  const fromStart = (dist: number): { x: number; y: number } => {
    let left = dist;
    for (const seg of segs) {
      if (left <= seg.len) return along(seg, left);
      left -= seg.len;
    }
    return segs[segs.length - 1]!.b;
  };
  const candidates: BusLabel[] = [];
  if (nearEnd === "end") {
    for (const d of [gap, gap + 14, gap + 28, total / 2]) candidates.push({ ...fromStart(Math.max(total - d, total / 2)), anchor: "end" });
  } else if (nearEnd === "start") {
    for (const d of [gap, gap + 14, gap + 28, total / 2]) candidates.push({ ...fromStart(Math.min(d, total / 2)), anchor: "start" });
  } else {
    const byLength = [...segs].sort((a, b) => b.len - a.len);
    for (const seg of byLength) {
      for (const f of [0.3, 0.5, 0.7, 0.15, 0.85]) {
        const t = Math.min(Math.max(10, seg.len * f), Math.max(seg.len - 10, seg.len / 2));
        candidates.push({ ...along(seg, t), anchor: "start" });
      }
    }
  }
  const rounded = candidates.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), anchor: c.anchor }));
  return rounded.find((c) => isClear(labelBox(c, textW), net, avoid)) ?? rounded[0];
}

/** Round every coordinate so wires land on whole pixels and corners stay sharp. */
export function roundLayout(layout: ElkGraphOut): ElkGraphOut {
  const r = (v: number): number => Math.round(v);
  return {
    ...layout,
    width: Math.ceil(layout.width),
    height: Math.ceil(layout.height),
    children: layout.children.map((c) => ({ ...c, x: r(c.x), y: r(c.y), ...(c.ports ? { ports: c.ports.map((p) => ({ ...p, x: r(p.x), y: r(p.y) })) } : {}) })),
    edges: layout.edges.map((e) => ({
      ...e,
      ...(e.sections
        ? {
            sections: e.sections.map((sec) => ({
              ...sec,
              startPoint: { x: r(sec.startPoint.x), y: r(sec.startPoint.y) },
              endPoint: { x: r(sec.endPoint.x), y: r(sec.endPoint.y) },
              ...(sec.bendPoints ? { bendPoints: sec.bendPoints.map((b) => ({ x: r(b.x), y: r(b.y) })) } : {}),
            })),
          }
        : {}),
      ...(e.junctionPoints ? { junctionPoints: e.junctionPoints.map((j) => ({ x: r(j.x), y: r(j.y) })) } : {}),
    })),
  };
}

function renderEdge(e: ElkEdgeOut, net: Net | undefined, showWidth: boolean, rippers: ReadonlySet<string>, avoid: Avoid, lines: SourceLines): { markup: string; labelled: boolean } {
  const d = edgePath(e);
  const width = net?.width ?? 1;
  const cls = `net${width > 1 ? " bus" : ""}${net?.role ? ` ${net.role}` : ""}${net?.warnings && net.warnings.length > 0 ? " warn" : ""}`;
  const netId = net?.id ?? e.id;
  const ownNet = netOfEdge(e.id);
  let label = "";
  if (width > 1 && showWidth) {
    const srcNode = e.sources[0]?.split(".")[0] ?? "";
    const dstNode = e.targets[0]?.split(".")[0] ?? "";
    const fromRipper = [...rippers].some((id) => (e.sources[0] ?? "").startsWith(`${id}.`)) || rippers.has(srcNode);
    // Only a join labels its inputs with a range; a split's input is the whole bus.
    const toRipper = [...rippers].some((id) => id.startsWith("join:") && (e.targets[0] ?? "").startsWith(`${id}.`)) || (dstNode.startsWith("join:") && rippers.has(dstNode));
    const mode = fromRipper && !toRipper ? "end" : toRipper && !fromRipper ? "start" : "middle";
    const endIsPort = mode === "end" ? dstNode.startsWith("port:") : mode === "start" ? srcNode.startsWith("port:") : false;
    // A slice leaving a split or a part entering a join is labelled with its range on the ripper itself.
    const p = fromRipper || toRipper ? undefined : busLabelPos(e, mode, endIsPort, ownNet, String(width).length * BUS_WIDTH_CHAR, avoid);
    if (p) {
      label =
        `<g class="bus-mark"><path class="bus-slash" d="M${fmt(p.x - 3)},${fmt(p.y + 4)} L${fmt(p.x + 3)},${fmt(p.y - 4)}"/>` +
        `<text class="bus-width" x="${fmt(p.anchor === "end" ? p.x - 4 : p.x + 4)}" y="${fmt(p.y - 3)}" text-anchor="${p.anchor}">${width}</text>` +
        `<title>${esc(TIP.bus(width))}</title></g>`;
    }
  }
  const title = netTooltip(net, netId, lines);
  const junctions = (e.junctionPoints ?? []).map((j) => `<circle class="junction" cx="${fmt(j.x)}" cy="${fmt(j.y)}" r="${fmt(junctionRadius(width))}"><title>${TIP.junction}</title></circle>`).join("");
  // Semantic warning badge on the first wire of the net (multiple drivers, combinational loop).
  let warn = "";
  if (showWidth && net?.warnings && net.warnings.length > 0) {
    const p = busLabelPos(e, "middle", false, ownNet, 12, avoid);
    if (p) {
      warn = `<g class="warn" data-warning="${esc(net.warnings.join(","))}"><path class="warn-badge" d="M${fmt(p.x)},${fmt(p.y - 13)} L${fmt(p.x + 6)},${fmt(p.y - 3)} L${fmt(p.x - 6)},${fmt(p.y - 3)} Z"/><text class="warn-badge-text" x="${fmt(p.x)}" y="${fmt(p.y - 4)}" text-anchor="middle">!</text><title>${esc(`warning: ${net.warnings.join(", ")}`)}</title></g>`;
    }
  }
  return { markup: `<g class="${cls}" data-net="${esc(netId)}"${net ? srcAttr(net.src) : ""}><path class="net-path" d="${d}"/>${label}${junctions}${warn}<title>${esc(title)}</title></g>`, labelled: label !== "" || warn !== "" };
}

/** Rounds the layout to whole pixels and splits 4-way junctions; the checks measure the same result. */
export function prepareLayout(rawLayout: ElkGraphOut, view: ModuleView): ElkGraphOut {
  const widthOf = new Map(view.nets.map((n) => [n.id, n.width] as const));
  return separateJunctions(roundLayout(rawLayout), (net) => junctionOffset(junctionRadius(widthOf.get(net) ?? 1)));
}

/** Everything a wire label must stay clear of, collected once per render. */
function avoidance(layout: ElkGraphOut, widthOf: (net: string) => number): Avoid {
  const avoid: Avoid = { segs: [], boxes: [], dots: [] };
  for (const e of layout.edges) {
    const net = netOfEdge(e.id);
    for (const s of e.sections ?? []) {
      const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
      for (let i = 0; i + 1 < pts.length; i++) avoid.segs.push({ net, a: pts[i]!, b: pts[i + 1]! });
    }
    for (const j of e.junctionPoints ?? []) avoid.dots.push({ net, x: j.x, y: j.y, r: junctionRadius(widthOf(net)) });
  }
  for (const c of layout.children) avoid.boxes.push({ x: c.x, y: c.y, w: c.width, h: c.height });
  return avoid;
}

/** Plain crossings get an invisible hit target so hovering explains that the wires do not connect. */
function crossingMarkers(avoid: Avoid): string {
  const out: string[] = [];
  const segs = avoid.segs;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i]!;
      const q = segs[j]!;
      if (p.net === q.net) continue;
      const pH = p.a.y === p.b.y;
      const qH = q.a.y === q.b.y;
      if (pH === qH) continue;
      const h = pH ? p : q;
      const v = pH ? q : p;
      const x = v.a.x;
      const y = h.a.y;
      if (x <= Math.min(h.a.x, h.b.x) || x >= Math.max(h.a.x, h.b.x) || y <= Math.min(v.a.y, v.b.y) || y >= Math.max(v.a.y, v.b.y)) continue;
      out.push(`<circle class="crossing" cx="${fmt(x)}" cy="${fmt(y)}" r="5"><title>${TIP.crossing}</title></circle>`);
    }
  }
  return out.join("");
}

export function renderModule(rawView: ModuleView, rawLayout: ElkGraphOut, opts: RenderOptions = {}): RenderedSvg {
  const view = expandLogicalGates(rawView);
  const lines = opts.sourceLines;
  const layout = prepareLayout(rawLayout, view);
  const idx = index(layout);
  const rippers = new Set(view.nodes.filter((n) => n.kind === "split" || n.kind === "join").map((n) => n.id));
  const nodeById = new Map(view.nodes.map((n) => [n.id, n] as const));
  const netById = new Map(view.nets.map((n) => [n.id, n] as const));
  const avoid = avoidance(layout, (net) => netById.get(net)?.width ?? 1);
  const parts: string[] = [];
  // The frame holds its title even when the layout is tiny (bug 1).
  const width = Math.max(layout.width, 60, opts.frame !== false ? frameMinWidth(view.name) : 0);
  const height = Math.max(layout.height, 40);
  if (opts.frame !== false) {
    parts.push(
      `<g class="module-frame"><rect class="module-rect" x="0.5" y="0.5" width="${fmt(width - 1)}" height="${fmt(height - 1)}" rx="6"/>` +
        `<text class="module-title" x="10" y="14">${esc(view.name)}</text></g>`,
    );
  }
  // Edges below nodes.
  const edges: string[] = [];
  const labelled = new Set<string>();
  for (const e of layout.edges) {
    const netId = e.id.replace(/^edge:/, "").replace(/:\d+$/, "");
    // One width label per net, on the first wire that can carry it.
    const r = renderEdge(e, netById.get(netId), !labelled.has(netId), rippers, avoid, lines);
    if (r.labelled) labelled.add(netId);
    edges.push(r.markup);
  }
  parts.push(`<g class="nets">${edges.join("")}</g>`);
  parts.push(`<g class="crossings">${crossingMarkers(avoid)}</g>`);
  const nodes: string[] = [];
  for (const p of view.ports) {
    const n = idx.nodes.get(portNodeId(p.name));
    if (n) nodes.push(renderPortNode(p, n, lines));
  }
  for (const n of layout.children) {
    const node = nodeById.get(n.id);
    if (node) nodes.push(renderNode(node, n, lines));
  }
  parts.push(`<g class="nodes">${nodes.join("")}</g>`);
  return { inner: parts.join(""), width, height };
}

/** Wrap rendered inner markup into a standalone SVG document (used by export). */
export function wrapSvgDocument(r: RenderedSvg, css: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(r.width)}" height="${fmt(r.height)}" viewBox="0 0 ${fmt(r.width)} ${fmt(r.height)}">` +
    `<style>${css}</style>` +
    r.inner +
    `</svg>`
  );
}
