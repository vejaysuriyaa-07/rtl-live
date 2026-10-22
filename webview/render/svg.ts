// Pure SVG string renderer: ELK layout + ModuleView -> SVG markup.
// No DOM access so it can be unit tested in node and reused for export.
import type { ModuleView, Net, Node, Pin, Port } from "../../src/ir/types";
import type { ElkEdgeOut, ElkGraphOut, ElkNodeOut, ElkPoint, ElkPortOut } from "../layout/types";
import { elkPortId, portNodeId } from "../layout/toElk";
import { symbolMarkup } from "./symbols";
import { frameMinWidth } from "./geometry";

export interface RenderOptions {
  /** Show the module frame and title */
  frame?: boolean;
  /** Stale (last good) rendering gets a class for dimming */
  stale?: boolean;
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

function renderPortNode(port: Port, n: ElkNodeOut): string {
  const isInput = port.direction === "input";
  const label = port.width > 1 ? `${port.name}${port.range ?? `[${port.width - 1}:0]`}` : port.name;
  const w = n.width;
  const h = n.height;
  // Pentagon pointing in the flow direction; inout is a hexagon.
  const shape =
    port.direction === "inout"
      ? `M8,0 H${fmt(w - 8)} L${fmt(w)},${fmt(h / 2)} L${fmt(w - 8)},${fmt(h)} H8 L0,${fmt(h / 2)} Z`
      : isInput
        ? `M0,0 H${fmt(w - 8)} L${fmt(w)},${fmt(h / 2)} L${fmt(w - 8)},${fmt(h)} H0 Z`
        : `M8,0 H${fmt(w)} V${fmt(h)} H8 L0,${fmt(h / 2)} Z`;
  const cls = `port port-${port.direction}${port.width > 1 ? " bus" : ""}${port.ghost ? ` ghost ghost-${port.ghost}` : ""}${port.tentative ? " tentative" : ""}`;
  const note = port.ghost === "added" ? " (added in the newer text, not synthesized yet)" : port.ghost === "removed" ? " (removed in the newer text)" : port.ghost === "changed" ? " (changed in the newer text)" : port.tentative ? " (recovered from broken text)" : "";
  return (
    `<g class="${cls}" data-port="${esc(port.name)}" data-id="${esc(portNodeId(port.name))}"${port.ghost ? ` data-ghost="${port.ghost}"` : ""}${srcAttr(port.src)} transform="translate(${fmt(n.x)},${fmt(n.y)})">` +
    `<path class="port-shape" d="${shape}"/>` +
    `<text class="port-label" x="${fmt(isInput ? 6 : w - 6)}" y="${fmt(h / 2)}" text-anchor="${isInput ? "start" : "end"}" dominant-baseline="central">${esc(label)}</text>` +
    `<title>${esc(`${port.direction} ${label} (${port.width > 0 ? port.width : "?"} bit${port.width === 1 ? "" : "s"})${note}`)}</title>` +
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

function renderNode(node: Node, n: ElkNodeOut): string {
  const pins = pinPositions(node, n);
  const body = symbolMarkup(node, n.width, n.height, pins);
  const cls = `node node-${node.kind}${node.op ? ` op-${node.op}` : ""}`;
  const tip = tooltip(node);
  return (
    `<g class="${cls}" data-id="${esc(node.id)}" data-kind="${node.kind}"${node.op ? ` data-op="${esc(node.op)}"` : ""}${node.drillTarget ? ` data-drill="${esc(node.drillTarget)}"` : ""}${srcAttr(node.src)} transform="translate(${fmt(n.x)},${fmt(n.y)})">` +
    body +
    `<title>${esc(tip)}</title>` +
    `</g>`
  );
}

export function tooltip(node: Node): string {
  const lines: string[] = [];
  lines.push(node.label || node.kind);
  if (node.op) lines.push(`op: ${node.op}`);
  if (node.width > 1) lines.push(`width: ${node.width}`);
  if (node.moduleType) lines.push(`module: ${node.moduleType}${node.kind === "blackbox" ? " (not defined in this file)" : ""}`);
  const s = node.src[0];
  if (s) lines.push(`line ${s.line}`);
  if (node.info) for (const [k, v] of Object.entries(node.info)) lines.push(`${k}: ${v}`);
  if (node.warnings && node.warnings.length > 0) lines.push(`warning: ${node.warnings.join(", ")}`);
  return lines.join("\n");
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

/**
 * Where the width label goes. Normally a little along the longest segment. A wire that
 * leaves a ripper carries the range label at that end, so the width goes near the other
 * end instead (12 px before a pin, 20 px before a port chevron), anchored away from it.
 */
function busLabelPos(e: ElkEdgeOut, nearEnd: "start" | "end" | "middle", endIsPort: boolean): BusLabel | undefined {
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
  if (nearEnd === "end") return { ...fromStart(Math.max(total - gap, total / 2)), anchor: "end" };
  if (nearEnd === "start") return { ...fromStart(Math.min(gap, total / 2)), anchor: "start" };
  const best = segs.reduce((m, x) => (x.len > m.len ? x : m), segs[0]!);
  const t = Math.min(Math.max(10, best.len * 0.3), Math.max(best.len - 10, best.len / 2));
  return { ...along(best, t), anchor: "start" };
}

/** Round every coordinate so wires land on whole pixels and corners stay sharp. */
function roundLayout(layout: ElkGraphOut): ElkGraphOut {
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

function renderEdge(e: ElkEdgeOut, net: Net | undefined, showWidth: boolean, rippers: ReadonlySet<string>): { markup: string; labelled: boolean } {
  const d = edgePath(e);
  const width = net?.width ?? 1;
  const cls = `net${width > 1 ? " bus" : ""}${net?.role ? ` ${net.role}` : ""}`;
  const netId = net?.id ?? e.id;
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
    const p = fromRipper || toRipper ? undefined : busLabelPos(e, mode, endIsPort);
    if (p) {
      label =
        `<path class="bus-slash" d="M${fmt(p.x - 3)},${fmt(p.y + 4)} L${fmt(p.x + 3)},${fmt(p.y - 4)}"/>` +
        `<text class="bus-width" x="${fmt(p.anchor === "end" ? p.x - 4 : p.x + 4)}" y="${fmt(p.y - 3)}" text-anchor="${p.anchor}">${width}</text>`;
    }
  }
  const title = net ? `${net.name ?? net.id}${net.aliases && net.aliases.length > 0 ? ` (also ${net.aliases.join(", ")})` : ""} (${width} bit${width === 1 ? "" : "s"})` : netId;
  const junctions = (e.junctionPoints ?? []).map((j) => `<circle class="junction" cx="${fmt(j.x)}" cy="${fmt(j.y)}" r="2.5"/>`).join("");
  return { markup: `<g class="${cls}" data-net="${esc(netId)}"${net ? srcAttr(net.src) : ""}><path class="net-path" d="${d}"/>${label}${junctions}<title>${esc(title)}</title></g>`, labelled: label !== "" };
}

export function renderModule(view: ModuleView, rawLayout: ElkGraphOut, opts: RenderOptions = {}): RenderedSvg {
  const layout = roundLayout(rawLayout);
  const idx = index(layout);
  const rippers = new Set(view.nodes.filter((n) => n.kind === "split" || n.kind === "join").map((n) => n.id));
  const nodeById = new Map(view.nodes.map((n) => [n.id, n] as const));
  const netById = new Map(view.nets.map((n) => [n.id, n] as const));
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
    const r = renderEdge(e, netById.get(netId), !labelled.has(netId), rippers);
    if (r.labelled) labelled.add(netId);
    edges.push(r.markup);
  }
  parts.push(`<g class="nets">${edges.join("")}</g>`);
  const nodes: string[] = [];
  for (const p of view.ports) {
    const n = idx.nodes.get(portNodeId(p.name));
    if (n) nodes.push(renderPortNode(p, n));
  }
  for (const n of layout.children) {
    const node = nodeById.get(n.id);
    if (node) nodes.push(renderNode(node, n));
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
