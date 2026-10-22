// Pure SVG string renderer: ELK layout + ModuleView -> SVG markup.
// No DOM access so it can be unit tested in node and reused for export.
import type { ModuleView, Net, Node, Pin, Port } from "../../src/ir/types";
import type { ElkEdgeOut, ElkGraphOut, ElkNodeOut, ElkPortOut } from "../layout/types";
import { elkPortId, portNodeId } from "../layout/toElk";
import { symbolMarkup } from "./symbols";

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
  return ` data-line="${s.line}" data-column="${s.column}" data-end-line="${s.endLine}" data-end-column="${s.endColumn}"`;
}

function renderPortNode(port: Port, n: ElkNodeOut): string {
  const isInput = port.direction === "input";
  const label = port.width > 1 ? `${port.name}${port.range ?? `[${port.width - 1}:0]`}` : port.name;
  const w = n.width;
  const h = n.height;
  // Chevron pointing in the flow direction.
  const shape = isInput
    ? `M0,0 H${fmt(w - 8)} L${fmt(w)},${fmt(h / 2)} L${fmt(w - 8)},${fmt(h)} H0 Z`
    : `M8,0 H${fmt(w)} V${fmt(h)} H8 L0,${fmt(h / 2)} Z`;
  const cls = `port port-${port.direction}${port.width > 1 ? " bus" : ""}`;
  return (
    `<g class="${cls}" data-port="${esc(port.name)}" data-id="${esc(portNodeId(port.name))}"${srcAttr(port.src)} transform="translate(${fmt(n.x)},${fmt(n.y)})">` +
    `<path class="port-shape" d="${shape}"/>` +
    `<text class="port-label" x="${fmt(isInput ? 6 : w - 6)}" y="${fmt(h / 2)}" text-anchor="${isInput ? "start" : "end"}" dominant-baseline="central">${esc(label)}</text>` +
    `<title>${esc(`${port.direction} ${label} (${port.width > 0 ? port.width : "?"} bit${port.width === 1 ? "" : "s"})`)}</title>` +
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

function busLabelPos(e: ElkEdgeOut): { x: number; y: number } | undefined {
  const s = e.sections?.[0];
  if (!s) return undefined;
  const a = s.startPoint;
  const b = s.bendPoints?.[0] ?? s.endPoint;
  // Put the slash a little along the first (horizontal) segment.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min(14, len / 2);
  return { x: a.x + (dx / len) * t, y: a.y + (dy / len) * t };
}

function renderEdge(e: ElkEdgeOut, net: Net | undefined, showWidth: boolean): string {
  const d = edgePath(e);
  const width = net?.width ?? 1;
  const cls = `net${width > 1 ? " bus" : ""}`;
  const netId = net?.id ?? e.id;
  let label = "";
  if (width > 1 && showWidth) {
    const p = busLabelPos(e);
    if (p) {
      label =
        `<path class="bus-slash" d="M${fmt(p.x - 3)},${fmt(p.y + 4)} L${fmt(p.x + 3)},${fmt(p.y - 4)}"/>` +
        `<text class="bus-width" x="${fmt(p.x + 4)}" y="${fmt(p.y - 3)}">${width}</text>`;
    }
  }
  const title = net ? `${net.name ?? net.id} (${width} bit${width === 1 ? "" : "s"})` : netId;
  const junctions = (e.junctionPoints ?? []).map((j) => `<circle class="junction" cx="${fmt(j.x)}" cy="${fmt(j.y)}" r="2.5"/>`).join("");
  return `<g class="${cls}" data-net="${esc(netId)}"${net ? srcAttr(net.src) : ""}><path class="net-path" d="${d}"/>${label}${junctions}<title>${esc(title)}</title></g>`;
}

export function renderModule(view: ModuleView, layout: ElkGraphOut, opts: RenderOptions = {}): RenderedSvg {
  const idx = index(layout);
  const nodeById = new Map(view.nodes.map((n) => [n.id, n] as const));
  const netById = new Map(view.nets.map((n) => [n.id, n] as const));
  const parts: string[] = [];
  const width = Math.max(layout.width, 60);
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
    // One width label per net: all edges of a net leave the same driver pin.
    const first = !labelled.has(netId);
    labelled.add(netId);
    edges.push(renderEdge(e, netById.get(netId), first));
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
