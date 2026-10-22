// Symbol shapes. M1 ships boxes, clouds, instances and constants; gate shapes arrive in M2.
import type { Node, Pin } from "../../src/ir/types";
import { esc, fmt } from "./svg";

export type PinPos = Map<string, { x: number; y: number; pin: Pin }>;

function pinStubs(node: Node, pins: PinPos, w: number, h: number, stub = 0): string {
  const out: string[] = [];
  for (const [, p] of pins) {
    const bus = p.pin.width > 1 ? " bus" : "";
    out.push(`<circle class="pin${bus}" data-pin="${esc(p.pin.id)}" cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="1.6"/>`);
    if (stub > 0) {
      const dx = p.pin.side === "west" ? -stub : p.pin.side === "east" ? stub : 0;
      const dy = p.pin.side === "south" ? stub : p.pin.side === "north" ? -stub : 0;
      out.push(`<path class="pin-stub${bus}" d="M${fmt(p.x)},${fmt(p.y)} l${fmt(dx)},${fmt(dy)}"/>`);
    }
  }
  void node;
  void w;
  void h;
  return out.join("");
}

function pinLabels(pins: PinPos): string {
  const out: string[] = [];
  for (const [, p] of pins) {
    if (!p.pin.label) continue;
    const side = p.pin.side;
    const x = side === "west" ? p.x + 5 : side === "east" ? p.x - 5 : p.x;
    const y = side === "south" ? p.y - 6 : side === "north" ? p.y + 10 : p.y;
    const anchor = side === "west" ? "start" : side === "east" ? "end" : "middle";
    out.push(`<text class="pin-label" x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor}" dominant-baseline="central">${esc(p.pin.label)}</text>`);
  }
  return out.join("");
}

function boxSymbol(node: Node, w: number, h: number, pins: PinPos, extraClass: string, dashed: boolean): string {
  return (
    `<rect class="body ${extraClass}${dashed ? " dashed" : ""}" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="3"/>` +
    `<text class="label title" x="${fmt(w / 2)}" y="11" text-anchor="middle">${esc(node.label)}</text>` +
    pinLabels(pins) +
    pinStubs(node, pins, w, h)
  );
}

function cloudSymbol(node: Node, w: number, h: number, pins: PinPos): string {
  return (
    `<rect class="body cloud dashed" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="10"/>` +
    `<text class="label" x="${fmt(w / 2)}" y="${fmt(h / 2)}" text-anchor="middle" dominant-baseline="central">${esc(node.label)}</text>` +
    pinStubs(node, pins, w, h)
  );
}

function constSymbol(node: Node, w: number, h: number, pins: PinPos): string {
  return (
    `<rect class="body const" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(h / 2)}"/>` +
    `<text class="label" x="${fmt(w / 2)}" y="${fmt(h / 2)}" text-anchor="middle" dominant-baseline="central">${esc(node.label)}</text>` +
    pinStubs(node, pins, w, h)
  );
}

function genericSymbol(node: Node, w: number, h: number, pins: PinPos): string {
  const label = node.op ? node.op : node.label || node.kind;
  return (
    `<rect class="body generic" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="3"/>` +
    `<text class="label" x="${fmt(w / 2)}" y="${fmt(h / 2)}" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>` +
    pinStubs(node, pins, w, h)
  );
}

export function symbolMarkup(node: Node, w: number, h: number, pins: PinPos): string {
  switch (node.kind) {
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
