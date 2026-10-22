// Symbol shapes: IEEE/ANSI distinctive-shape gates, reduction gates, mux
// trapezoid, DFF box with clock triangle, arithmetic/comparator boxes,
// constant pills, instance and black-box boxes, split/join bars and clouds.
// Every function returns markup placed inside the node's <g> (origin top-left).
import type { Node, Pin } from "../../src/ir/types";
import { esc, fmt } from "./svg";

export type PinPos = Map<string, { x: number; y: number; pin: Pin }>;

const BUBBLE_R = 3;

function pinMarkers(pins: PinPos): string {
  const out: string[] = [];
  for (const [, p] of pins) {
    const bus = p.pin.width > 1 ? " bus" : "";
    out.push(`<circle class="pin${bus}" data-pin="${esc(p.pin.id)}" cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="1.4"/>`);
    if (p.pin.inverted) {
      const dx = p.pin.side === "west" ? BUBBLE_R : p.pin.side === "east" ? -BUBBLE_R : 0;
      const dy = p.pin.side === "south" ? -BUBBLE_R : p.pin.side === "north" ? BUBBLE_R : 0;
      out.push(`<circle class="bubble" cx="${fmt(p.x + dx)}" cy="${fmt(p.y + dy)}" r="${BUBBLE_R}"/>`);
    }
  }
  return out.join("");
}

function pinLabels(pins: PinPos, inset = 5): string {
  const out: string[] = [];
  for (const [, p] of pins) {
    if (!p.pin.label) continue;
    const side = p.pin.side;
    const x = side === "west" ? p.x + inset : side === "east" ? p.x - inset : p.x;
    const y = side === "south" ? p.y - 8 : side === "north" ? p.y + 10 : p.y;
    const anchor = side === "west" ? "start" : side === "east" ? "end" : "middle";
    out.push(`<text class="pin-label" x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor}" dominant-baseline="central">${esc(p.pin.label)}</text>`);
  }
  return out.join("");
}

/** Ripper labels for split/join pins, drawn just outside the bar along the wire. */
function bitLabels(pins: PinPos): string {
  const out: string[] = [];
  for (const [, p] of pins) {
    if (!p.pin.bits) continue;
    // Both sides hang their label to the right of the bar, over the outgoing wire, so a split
    // next to a join never crosses labels.
    const x = p.pin.side === "west" ? p.x + 10 : p.x + 3;
    const anchor = "start";
    // A repeated input shows its count; the range it fills is in the tooltip.
    const text = p.pin.label ? p.pin.label : p.pin.bits;
    const tip = p.pin.label ? `${p.pin.bits} = ${p.pin.width} bit${p.pin.width === 1 ? "" : "s"} ${p.pin.label}` : `${p.pin.bits} (${p.pin.width} bit${p.pin.width === 1 ? "" : "s"})`;
    out.push(`<text class="ripper-label" x="${fmt(x)}" y="${fmt(p.y - 3)}" text-anchor="${anchor}"><title>${esc(tip)}</title>${esc(text)}</text>`);
  }
  return out.join("");
}

function outputBubble(w: number, h: number): string {
  return `<circle class="bubble" cx="${fmt(w - BUBBLE_R)}" cy="${fmt(h / 2)}" r="${BUBBLE_R}"/>`;
}

/** Stubs from the west edge to the gate body for OR-family shapes with a concave back. */
function westStubs(pins: PinPos, toX: number): string {
  const out: string[] = [];
  for (const [, p] of pins) {
    if (p.pin.side !== "west") continue;
    out.push(`<path class="pin-stub" d="M${fmt(p.x + (p.pin.inverted ? BUBBLE_R * 2 : 0))},${fmt(p.y)} H${fmt(toX)}"/>`);
  }
  return out.join("");
}

function andPath(x0: number, w: number, h: number): string {
  const flat = x0 + (w - x0) * 0.45;
  const r = h / 2;
  return `M${fmt(x0)},0 H${fmt(flat)} A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(flat)},${fmt(h)} H${fmt(x0)} Z`;
}

function orPath(x0: number, w: number, h: number): string {
  const cx = x0 + (w - x0) * 0.35;
  return `M${fmt(x0)},0 Q${fmt(cx)},0 ${fmt(w)},${fmt(h / 2)} Q${fmt(cx)},${fmt(h)} ${fmt(x0)},${fmt(h)} Q${fmt(x0 + (w - x0) * 0.3)},${fmt(h / 2)} ${fmt(x0)},0 Z`;
}

function xorExtra(x0: number, w: number, h: number): string {
  const x = x0 - 5;
  return `<path class="gate-line" d="M${fmt(x)},0 Q${fmt(x + (w - x0) * 0.3)},${fmt(h / 2)} ${fmt(x)},${fmt(h)}"/>`;
}

function gateSymbol(node: Node, w: number, h: number, pins: PinPos): string {
  const op = node.op ?? "and";
  const bubbleOut = op === "nand" || op === "nor" || op === "xnor" || op === "not";
  const bodyW = bubbleOut ? w - BUBBLE_R * 2 : w;
  const x0 = 6; // leave room for input bubbles
  let body = "";
  switch (op) {
    case "and":
    case "nand":
      body = `<path class="gate-body" d="${andPath(x0, bodyW, h)}"/>`;
      break;
    case "or":
    case "nor":
      body = `<path class="gate-body" d="${orPath(x0, bodyW, h)}"/>`;
      break;
    case "xor":
    case "xnor":
      body = `<path class="gate-body" d="${orPath(x0 + 4, bodyW, h)}"/>${xorExtra(x0 + 4, bodyW, h)}`;
      break;
    case "not":
    case "buf":
      body = `<path class="gate-body" d="M${fmt(x0)},0 L${fmt(bodyW)},${fmt(h / 2)} L${fmt(x0)},${fmt(h)} Z"/>`;
      break;
    default:
      body = `<rect class="gate-body" x="${fmt(x0)}" y="0" width="${fmt(bodyW - x0)}" height="${fmt(h)}" rx="3"/><text class="label" x="${fmt(w / 2)}" y="${fmt(h / 2)}" text-anchor="middle" dominant-baseline="central">${esc(op)}</text>`;
  }
  const stubTo = op === "xor" || op === "xnor" ? x0 + 1 : x0 + 2;
  return westStubs(pins, stubTo) + body + (bubbleOut ? outputBubble(w, h) : "") + (node.info?.["logical"] ? `<text class="glyph small" x="${fmt(w / 2 + 2)}" y="${fmt(h / 2)}" text-anchor="middle" dominant-baseline="central">${op === "and" ? "&amp;&amp;" : "||"}</text>` : "") + pinMarkers(pins);
}

const REDUCE_GLYPH: Record<string, string> = { and: "&amp;", or: "|", xor: "^", xnor: "~^", nand: "~&amp;", nor: "~|" };

function reduceSymbol(node: Node, w: number, h: number, pins: PinPos): string {
  const op = node.op ?? "and";
  const base = op === "nand" ? "and" : op === "nor" ? "or" : op === "xnor" ? "xor" : op;
  const bubbleOut = op === "nand" || op === "nor" || op === "xnor";
  const bodyW = bubbleOut ? w - BUBBLE_R * 2 : w;
  const x0 = 6;
  let body = "";
  if (base === "and") body = `<path class="gate-body" d="${andPath(x0, bodyW, h)}"/>`;
  else if (base === "or") body = `<path class="gate-body" d="${orPath(x0, bodyW, h)}"/>`;
  else body = `<path class="gate-body" d="${orPath(x0 + 4, bodyW, h)}"/>${xorExtra(x0 + 4, bodyW, h)}`;
  const glyph = `<text class="glyph" x="${fmt(x0 + (bodyW - x0) * 0.5)}" y="${fmt(h / 2)}" text-anchor="middle" dominant-baseline="central">${REDUCE_GLYPH[op] ?? op}</text>`;
  return westStubs(pins, x0 + 2) + body + glyph + (bubbleOut ? outputBubble(w, h) : "") + pinMarkers(pins);
}

function muxSymbol(node: Node, w: number, h: number, pins: PinPos): string {
  const inset = h * 0.18;
  const body = `<path class="body" d="M0,0 L${fmt(w)},${fmt(inset)} L${fmt(w)},${fmt(h - inset)} L0,${fmt(h)} Z"/>`;
  void node;
  return body + pinLabels(pins, 4) + pinMarkers(pins);
}

function dffSymbol(node: Node, w: number, h: number, pins: PinPos): string {
  const parts: string[] = [`<rect class="body" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="2"/>`];
  for (const [, p] of pins) {
    if (p.pin.id === "CLK") {
      // Clock triangle pointing into the box from the bottom edge.
      parts.push(`<path class="clk-tri" d="M${fmt(p.x - 4.5)},${fmt(p.y)} L${fmt(p.x)},${fmt(p.y - 6)} L${fmt(p.x + 4.5)},${fmt(p.y)}"/>`);
    }
  }
  parts.push(`<text class="label title" x="${fmt(w / 2)}" y="11" text-anchor="middle">${esc(node.label)}</text>`);
  parts.push(pinLabels(pins));
  parts.push(pinMarkers(pins));
  return parts.join("");
}

function glyphBoxSymbol(node: Node, w: number, h: number, pins: PinPos): string {
  return (
    `<rect class="body" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="4"/>` +
    `<text class="glyph" x="${fmt(w / 2)}" y="${fmt(h / 2)}" text-anchor="middle" dominant-baseline="central">${esc(node.label)}</text>` +
    pinMarkers(pins)
  );
}

function splitJoinSymbol(_node: Node, w: number, h: number, pins: PinPos): string {
  return `<rect class="ripper" x="${fmt(w / 2 - 2)}" y="0" width="4" height="${fmt(h)}" rx="1"/>` + bitLabels(pins) + pinMarkers(pins);
}

function boxSymbol(node: Node, w: number, h: number, pins: PinPos, extraClass: string, dashed: boolean): string {
  return (
    `<rect class="body ${extraClass}${dashed ? " dashed" : ""}" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="3"/>` +
    `<text class="label title" x="${fmt(w / 2)}" y="11" text-anchor="middle">${esc(node.label)}</text>` +
    pinLabels(pins) +
    pinMarkers(pins)
  );
}

function cloudSymbol(node: Node, w: number, h: number, pins: PinPos): string {
  return (
    `<rect class="body cloud dashed" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="10"/>` +
    `<text class="label" x="${fmt(w / 2)}" y="${fmt(h / 2)}" text-anchor="middle" dominant-baseline="central">${esc(node.label)}</text>` +
    pinMarkers(pins)
  );
}

function constSymbol(node: Node, w: number, h: number, pins: PinPos): string {
  return (
    `<rect class="body const" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(h / 2)}"/>` +
    `<text class="label" x="${fmt(w / 2)}" y="${fmt(h / 2)}" text-anchor="middle" dominant-baseline="central">${esc(node.label)}</text>` +
    pinMarkers(pins)
  );
}

function genericSymbol(node: Node, w: number, h: number, pins: PinPos): string {
  return (
    `<rect class="body generic dashed" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="3"/>` +
    `<text class="label title" x="${fmt(w / 2)}" y="11" text-anchor="middle">${esc(node.label)}</text>` +
    pinLabels(pins) +
    pinMarkers(pins)
  );
}

/** Small warning triangle in the top-right corner for nodes with warnings (an inferred latch). */
function warningBadge(node: Node, w: number): string {
  if (!node.warnings || node.warnings.length === 0) return "";
  const x = w - 7;
  const y = 7;
  return `<g class="warn" data-warning="${esc(node.warnings.join(","))}"><path class="warn-badge" d="M${fmt(x)},${fmt(y - 6)} L${fmt(x + 6)},${fmt(y + 4)} L${fmt(x - 6)},${fmt(y + 4)} Z"/><text class="warn-badge-text" x="${fmt(x)}" y="${fmt(y + 3)}" text-anchor="middle">!</text><title>${esc(`warning: ${node.warnings.join(", ")}`)}</title></g>`;
}

export function symbolMarkup(node: Node, w: number, h: number, pins: PinPos): string {
  return symbolBody(node, w, h, pins) + warningBadge(node, w);
}

function symbolBody(node: Node, w: number, h: number, pins: PinPos): string {
  switch (node.kind) {
    case "gate":
      return gateSymbol(node, w, h, pins);
    case "reduce":
      return reduceSymbol(node, w, h, pins);
    case "mux":
    case "pmux":
      return muxSymbol(node, w, h, pins);
    case "dff":
      return dffSymbol(node, w, h, pins);
    case "arith":
    case "compare":
    case "shift":
      return glyphBoxSymbol(node, w, h, pins);
    case "split":
    case "join":
      return splitJoinSymbol(node, w, h, pins);
    case "cloud":
      return cloudSymbol(node, w, h, pins);
    case "const":
      return constSymbol(node, w, h, pins);
    case "instance":
      return boxSymbol(node, w, h, pins, "instance", false);
    case "blackbox":
      return boxSymbol(node, w, h, pins, "blackbox", true);
    default:
      return genericSymbol(node, w, h, pins);
  }
}
