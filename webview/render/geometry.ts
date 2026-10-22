// Node sizing shared by the layout (ELK needs sizes) and the renderer.
import type { Node, Port } from "../../src/ir/types";

export const CHAR_W = 6.6; // approx width of one character at 11px monospace-ish UI font
export const PIN_PITCH = 16;
export const PORT_NODE_HEIGHT = 20;
export const GATE_W = 44;
export const GATE_H = 28;

export function textWidth(s: string, charW = CHAR_W): number {
  return Math.ceil(s.length * charW);
}

export function portNodeWidth(port: Port): number {
  const label = port.width > 1 ? `${port.name}${port.range ?? `[${port.width - 1}:0]`}` : port.name;
  return textWidth(label) + 18;
}

export interface Size {
  width: number;
  height: number;
}

function sidePins(node: Node, side: "west" | "east" | "south" | "north"): number {
  return node.pins.filter((p) => p.side === side).length;
}

export function nodeSize(node: Node): Size {
  const west = sidePins(node, "west");
  const east = sidePins(node, "east");
  const south = sidePins(node, "south");
  const rows = Math.max(west, east, 1);
  switch (node.kind) {
    case "gate":
    case "reduce":
      return { width: GATE_W, height: Math.max(GATE_H, rows * 12 + 8) };
    case "mux":
    case "pmux":
      return { width: 30, height: Math.max(40, rows * PIN_PITCH + 10) };
    case "dff":
      return { width: 56, height: Math.max(48, rows * PIN_PITCH + 16) };
    case "arith":
    case "compare":
    case "shift":
      return { width: 44, height: Math.max(36, rows * PIN_PITCH + 8) };
    case "const":
      return { width: textWidth(node.label) + 14, height: 18 };
    case "split":
    case "join":
      return { width: 10, height: Math.max(20, rows * 12) };
    case "cloud": {
      const w = Math.max(70, textWidth(node.label) + 20, south * PIN_PITCH + 10);
      return { width: w, height: Math.max(34, rows * PIN_PITCH + 14) };
    }
    case "instance":
    case "blackbox":
    case "unknown":
    default: {
      const pinLabelW = Math.max(
        0,
        ...node.pins.filter((p) => p.side === "west").map((p) => textWidth(p.label)),
      );
      const pinLabelE = Math.max(
        0,
        ...node.pins.filter((p) => p.side === "east").map((p) => textWidth(p.label)),
      );
      const w = Math.max(80, textWidth(node.label) + 16, pinLabelW + pinLabelE + 30, south * PIN_PITCH + 10);
      return { width: w, height: Math.max(40, rows * PIN_PITCH + 22) };
    }
  }
}
