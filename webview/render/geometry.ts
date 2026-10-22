// Node sizing shared by the layout (ELK needs sizes) and the renderer.
import type { Node, Port } from "../../src/ir/types";

export const CHAR_W = 6.6; // approx width of one character at 11px UI font
export const PIN_PITCH = 16;
export const PORT_NODE_HEIGHT = 20;
export const GATE_W = 48;
export const GATE_H = 30;
/** Fit never zooms past this factor (text keeps its designed size; 1 means at most 100%). */
export const FIT_MAX_SCALE = 1;
/** Nominal sidebar viewport used by the layout checks and the Playwright harness. */
export const NOMINAL_VIEWPORT = { width: 900, height: 600 };

export function textWidth(s: string, charW = CHAR_W): number {
  return Math.ceil(s.length * charW);
}

/** Module title font (12 px sans) and the frame padding around it. */
export const TITLE_CHAR_W = 12 * 0.6;
export const TITLE_PAD = 24;

/** Width a module frame needs to hold its title, whatever the layout size. */
export function frameMinWidth(title: string): number {
  return textWidth(title, TITLE_CHAR_W) + TITLE_PAD;
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
      return { width: GATE_W, height: Math.max(GATE_H, rows * 12 + 10) };
    case "reduce":
      return { width: GATE_W, height: GATE_H };
    case "mux":
    case "pmux":
      return { width: 30, height: Math.max(44, rows * PIN_PITCH + 12) };
    case "dff":
      return { width: 56, height: Math.max(52, rows * PIN_PITCH + 22) };
    case "arith":
    case "compare":
    case "shift":
      return { width: 44, height: Math.max(38, rows * PIN_PITCH + 10) };
    case "const":
      return { width: textWidth(node.label) + 14, height: 18 };
    case "split":
    case "join":
      return { width: 8, height: Math.max(24, rows * 14 + 6) };
    case "cloud": {
      const w = Math.max(70, textWidth(node.label) + 20, south * PIN_PITCH + 10);
      return { width: w, height: Math.max(34, rows * PIN_PITCH + 14) };
    }
    case "instance":
    case "blackbox":
    case "unknown":
    default: {
      const pinLabelW = Math.max(0, ...node.pins.filter((p) => p.side === "west").map((p) => textWidth(p.label)));
      const pinLabelE = Math.max(0, ...node.pins.filter((p) => p.side === "east").map((p) => textWidth(p.label)));
      const w = Math.max(80, textWidth(node.label) + 16, pinLabelW + pinLabelE + 30, south * PIN_PITCH + 10);
      return { width: w, height: Math.max(40, rows * PIN_PITCH + 22) };
    }
  }
}
