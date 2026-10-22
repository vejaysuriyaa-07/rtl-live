// Yosys cell type -> IR node kind/op and pin layout.
import type { NodeKind, PinSide } from "./types";
import type { YosysCell } from "../synth/yosysJson";
import { paramInt } from "../synth/yosysJson";

export interface PinSpec {
  /** Yosys connection name */
  conn: string;
  id: string;
  label: string;
  direction: "in" | "out";
  side: PinSide;
  /** Pin is active-low (drawn with a bubble) */
  inverted?: boolean;
}

export interface CellSpec {
  kind: NodeKind;
  op?: string;
  pins: PinSpec[];
  label: string;
  warnings?: string[];
  info?: Record<string, string>;
}

const GATE_OPS: Record<string, string> = {
  $and: "and",
  $or: "or",
  $xor: "xor",
  $xnor: "xnor",
  $not: "not",
  $logic_not: "not",
  $logic_and: "and",
  $logic_or: "or",
  $buf: "buf",
  $pos: "buf",
};

/** Logical operators (&&, ||, !) reduce each operand to one bit; they are drawn and exported differently from bitwise ones. */
const LOGICAL_TYPES = new Set(["$logic_and", "$logic_or", "$logic_not"]);

const REDUCE_OPS: Record<string, string> = {
  $reduce_and: "and",
  $reduce_or: "or",
  $reduce_xor: "xor",
  $reduce_xnor: "xnor",
  $reduce_bool: "or",
};

const ARITH_OPS: Record<string, string> = { $add: "add", $sub: "sub", $mul: "mul", $neg: "neg", $div: "div", $mod: "mod", $pow: "pow" };
const COMPARE_OPS: Record<string, string> = { $eq: "eq", $ne: "ne", $lt: "lt", $le: "le", $gt: "gt", $ge: "ge", $eqx: "eq", $nex: "ne" };
const SHIFT_OPS: Record<string, string> = { $shl: "shl", $shr: "shr", $sshl: "shl", $sshr: "sshr", $shift: "shift", $shiftx: "shift" };

const OP_GLYPH: Record<string, string> = {
  add: "+",
  sub: "−",
  mul: "×",
  neg: "−x",
  div: "÷",
  mod: "%",
  pow: "**",
  eq: "=",
  ne: "≠",
  lt: "<",
  le: "≤",
  gt: ">",
  ge: "≥",
  shl: "<<",
  shr: ">>",
  sshr: ">>>",
  shift: "<<>>",
};

const DFF_TYPES = new Set(["$dff", "$adff", "$sdff", "$dffe", "$adffe", "$sdffe", "$sdffce", "$aldff", "$aldffe", "$dlatch", "$adlatch", "$dffsr", "$dffsre", "$sr"]);

function ab(): PinSpec[] {
  return [
    { conn: "A", id: "A", label: "", direction: "in", side: "west" },
    { conn: "B", id: "B", label: "", direction: "in", side: "west" },
    { conn: "Y", id: "Y", label: "", direction: "out", side: "east" },
  ];
}

export function cellSpec(cell: YosysCell): CellSpec {
  const t = cell.type;
  const p = cell.parameters ?? {};
  if (GATE_OPS[t] !== undefined) {
    const op = GATE_OPS[t]!;
    const logical = LOGICAL_TYPES.has(t) ? { info: { logical: "1" } } : {};
    if (op === "not" || op === "buf") {
      return {
        kind: "gate",
        op,
        label: op.toUpperCase(),
        pins: [
          { conn: "A", id: "A", label: "", direction: "in", side: "west" },
          { conn: "Y", id: "Y", label: "", direction: "out", side: "east" },
        ],
        ...logical,
      };
    }
    return { kind: "gate", op, label: op.toUpperCase(), pins: ab(), ...logical };
  }
  if (REDUCE_OPS[t] !== undefined) {
    const op = REDUCE_OPS[t]!;
    return {
      kind: "reduce",
      op,
      label: `${op.toUpperCase()}`,
      pins: [
        { conn: "A", id: "A", label: "", direction: "in", side: "west" },
        { conn: "Y", id: "Y", label: "", direction: "out", side: "east" },
      ],
    };
  }
  if (t === "$mux") {
    return {
      kind: "mux",
      label: "MUX",
      pins: [
        { conn: "A", id: "A", label: "0", direction: "in", side: "west" },
        { conn: "B", id: "B", label: "1", direction: "in", side: "west" },
        { conn: "S", id: "S", label: "", direction: "in", side: "south" },
        { conn: "Y", id: "Y", label: "", direction: "out", side: "east" },
      ],
    };
  }
  if (t === "$pmux" || t === "$bmux") {
    // Pins are expanded by fromYosys because B is a concatenation of S_WIDTH inputs.
    return { kind: "pmux", label: t === "$pmux" ? "PMUX" : "BMUX", pins: [] };
  }
  if (DFF_TYPES.has(t)) {
    const pins: PinSpec[] = [{ conn: "D", id: "D", label: "D", direction: "in", side: "west" }];
    const warnings: string[] = [];
    const info: Record<string, string> = {};
    const hasClk = "CLK" in cell.connections;
    if (hasClk) {
      const pol = paramInt(p["CLK_POLARITY"], 1);
      pins.push({ conn: "CLK", id: "CLK", label: "", direction: "in", side: "south", ...(pol === 0 ? { inverted: true } : {}) });
      info["clock"] = pol === 0 ? "negedge" : "posedge";
    }
    if ("EN" in cell.connections) {
      const pol = paramInt(p["EN_POLARITY"], 1);
      pins.push({ conn: "EN", id: "EN", label: "EN", direction: "in", side: "west", ...(pol === 0 ? { inverted: true } : {}) });
    }
    if ("ARST" in cell.connections) {
      const pol = paramInt(p["ARST_POLARITY"], 1);
      pins.push({ conn: "ARST", id: "R", label: "R", direction: "in", side: "west", ...(pol === 0 ? { inverted: true } : {}) });
      info["reset"] = `async, value ${String(p["ARST_VALUE"] ?? "?")}`;
    }
    if ("SRST" in cell.connections) {
      const pol = paramInt(p["SRST_POLARITY"], 1);
      pins.push({ conn: "SRST", id: "R", label: "R", direction: "in", side: "west", ...(pol === 0 ? { inverted: true } : {}) });
      info["reset"] = `sync, value ${String(p["SRST_VALUE"] ?? "?")}`;
    }
    if ("AD" in cell.connections) pins.push({ conn: "AD", id: "AD", label: "AD", direction: "in", side: "west" });
    if ("ALOAD" in cell.connections) pins.push({ conn: "ALOAD", id: "AL", label: "AL", direction: "in", side: "west" });
    if ("SET" in cell.connections) pins.push({ conn: "SET", id: "SET", label: "S", direction: "in", side: "west" });
    if ("CLR" in cell.connections) pins.push({ conn: "CLR", id: "CLR", label: "C", direction: "in", side: "west" });
    pins.push({ conn: "Q", id: "Q", label: "Q", direction: "out", side: "east" });
    const isLatch = t.includes("latch") || t === "$sr";
    if (isLatch) warnings.push("latch");
    return { kind: "dff", op: t.slice(1), label: isLatch ? "LATCH" : "DFF", pins, warnings, info };
  }
  if (ARITH_OPS[t] !== undefined) {
    const op = ARITH_OPS[t]!;
    if (op === "neg") {
      return {
        kind: "arith",
        op,
        label: OP_GLYPH[op] ?? op,
        pins: [
          { conn: "A", id: "A", label: "", direction: "in", side: "west" },
          { conn: "Y", id: "Y", label: "", direction: "out", side: "east" },
        ],
      };
    }
    return { kind: "arith", op, label: OP_GLYPH[op] ?? op, pins: ab() };
  }
  if (COMPARE_OPS[t] !== undefined) {
    const op = COMPARE_OPS[t]!;
    return { kind: "compare", op, label: OP_GLYPH[op] ?? op, pins: ab() };
  }
  if (SHIFT_OPS[t] !== undefined) {
    const op = SHIFT_OPS[t]!;
    return { kind: "shift", op, label: OP_GLYPH[op] ?? op, pins: ab() };
  }
  // Unknown: generic labelled box with pins from port_directions.
  const pins: PinSpec[] = [];
  const dirs = cell.port_directions ?? {};
  for (const conn of Object.keys(cell.connections)) {
    const d = dirs[conn] === "output" ? "out" : "in";
    pins.push({ conn, id: conn, label: conn, direction: d, side: d === "out" ? "east" : "west" });
  }
  return { kind: "unknown", op: t.replace(/^\$/, ""), label: t, pins };
}

export function isBlackboxCellType(t: string): boolean {
  return !t.startsWith("$");
}
