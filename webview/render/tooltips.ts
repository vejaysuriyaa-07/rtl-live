// Plain-language tooltips for every element (bug 18), written for a first-week Verilog
// learner. Each ends with the source line the element came from when one is known.
import type { Net, Node, Port, SrcRange } from "../../src/ir/types";
import { ALL_ZERO, ANY_ONE, isReduceBox } from "./logical";

export const TIP = {
  bus: (n: number): string => `${n} separate wires drawn as one line (a bus).`,
  wire: "One wire, 1 bit.",
  join: "Glues buses together. The top input becomes the upper bits, the bottom input the lower bits.",
  split: "Takes some bits out of a bus. The label shows which bits.",
  junction: "Wires connect here.",
  crossing: "These wires cross but do not connect.",
  bubble: "Flips the bit: 0 becomes 1, 1 becomes 0.",
  bitwise: "One gate per bit, all working at the same time.",
  logical: "Treats each input as true (any bit is 1) or false (all bits 0). Output is 1 bit.",
  anyOne: "Outputs 1 if any input bit is 1 (OR of all bits).",
  allZero: "Outputs 1 if every input bit is 0 (NOR of all bits).",
  mux: "Picks one input based on the select value. Inputs are labelled with the select value that chooses them.",
  dff: "Stores a value. Updates only on the clock edge (the triangle).",
  latch: "This is a latch, usually created by accident when an if or case does not assign a value on every path.",
  constant: "A fixed value from your code, like 1'b0.",
  blackbox: "A module used here but not defined in this file. Pins guessed from how it is connected.",
  instance: "A module defined in this file, used here. Double-click to look inside.",
  cloud: "Logic from your code, drawn as a box until synthesis turns it into gates.",
  input: "Input to this module. Driven from outside.",
  output: "Output of this module. Driven by the logic inside.",
  inout: "Goes both ways: this module and the outside can both drive it.",
  clock: "Clock input. The stored value updates on this edge.",
  enable: "Enable. The stored value updates only when this is 1.",
  reset: "Reset. Forces the stored value back to its reset value.",
  select: "Select. Its value picks which input comes out.",
  warning: "Something to check.",
} as const;

const GATE_SENTENCE: Record<string, string> = {
  and: "AND gate: output is 1 only when every input is 1.",
  or: "OR gate: output is 1 when any input is 1.",
  xor: "XOR gate: output is 1 when the inputs differ (an odd number of 1s).",
  xnor: "XNOR gate: output is 1 when the inputs are equal.",
  nand: "NAND gate: AND, then flipped. Output is 0 only when every input is 1.",
  nor: "NOR gate: OR, then flipped. Output is 1 only when every input is 0.",
  not: "NOT gate: flips the bit. 0 becomes 1, 1 becomes 0.",
  buf: "Buffer: passes the value through unchanged.",
};

const LOGICAL_NAME: Record<string, string> = { and: "Logical AND (&&)", or: "Logical OR (||)", not: "Logical NOT (!)" };

const ARITH: Record<string, string> = {
  add: "Adder: output is A plus B.",
  sub: "Subtractor: output is A minus B.",
  mul: "Multiplier: output is A times B.",
  neg: "Negate: output is minus A.",
  eq: "Comparator: output is 1 when A equals B.",
  ne: "Comparator: output is 1 when A differs from B.",
  lt: "Comparator: output is 1 when A is less than B.",
  le: "Comparator: output is 1 when A is less than or equal to B.",
  gt: "Comparator: output is 1 when A is greater than B.",
  ge: "Comparator: output is 1 when A is greater than or equal to B.",
  shl: "Shift left: A moved left by B bits.",
  shr: "Shift right: A moved right by B bits.",
  sshr: "Arithmetic shift right: A moved right by B bits, keeping the sign.",
  shift: "Shifter: A moved by B bits.",
};

const REDUCE: Record<string, string> = {
  and: "Combines every bit of the input with AND: 1 only when all bits are 1.",
  or: "Combines every bit of the input with OR: 1 when any bit is 1.",
  xor: "Combines every bit of the input with XOR: 1 when an odd number of bits are 1.",
  xnor: "Combines every bit of the input with XNOR: 1 when an even number of bits are 1.",
  nand: "Combines every bit with AND, then flips: 0 only when all bits are 1.",
  nor: "Combines every bit with OR, then flips: 1 only when every bit is 0.",
};

export type SourceLines = readonly string[] | undefined;

/** "from line 9: assign y = a || b;" when the text is known, "from line 9" otherwise. */
export function fromLine(src: SrcRange[] | undefined, lines: SourceLines): string {
  const s = src?.[0];
  if (!s) return "";
  const text = lines?.[s.line - 1]?.trim();
  return text ? `from line ${s.line}: ${text}` : `from line ${s.line}`;
}

function bitsOf(n: number): string {
  return `${n} bit${n === 1 ? "" : "s"}`;
}

function ripperPins(node: Node): string {
  const ins = node.pins.filter((p) => (node.kind === "join" ? p.direction === "in" : p.direction === "out") && p.bits);
  return ins.map((p) => `${p.bits}${p.label ? ` (${p.label})` : ""}`).join(", ");
}

/** The tooltip body for a node: a name line, one plain sentence, then details. */
export function nodeTooltipLines(node: Node): string[] {
  const out: string[] = [];
  const w = node.width;
  switch (node.kind) {
    case "gate": {
      const op = node.op ?? "and";
      if (node.info?.["logical"] === "1") {
        out.push(LOGICAL_NAME[op] ?? `Logical ${op.toUpperCase()}`);
        out.push(TIP.logical);
      } else {
        out.push(w > 1 ? `${op.toUpperCase()} gate, ${w} bits wide` : `${op.toUpperCase()} gate`);
        out.push(GATE_SENTENCE[op] ?? `${op} gate.`);
        if (w > 1) out.push(TIP.bitwise);
      }
      break;
    }
    case "reduce": {
      const op = node.op ?? "or";
      if (isReduceBox(node)) {
        const label = node.info?.["reduceLabel"] ?? ANY_ONE;
        out.push(`${label} (${bitsOf(w)} in, 1 bit out)`);
        out.push(label === ALL_ZERO ? TIP.allZero : TIP.anyOne);
      } else {
        out.push(`Reduce ${op.toUpperCase()} (${bitsOf(w)} in, 1 bit out)`);
        out.push(REDUCE[op] ?? `Combines every bit of the input with ${op}.`);
      }
      break;
    }
    case "mux":
    case "pmux": {
      const inputs = node.pins.filter((p) => p.direction === "in" && p.side === "west").length;
      out.push(`${inputs}-way mux${w > 1 ? `, ${bitsOf(w)}` : ""}`);
      out.push(TIP.mux);
      if (node.info?.["selector"]) out.push(`Select comes from ${node.info["selector"]}.`);
      break;
    }
    case "dff": {
      const latch = node.label === "LATCH" || node.warnings?.includes("latch");
      out.push(latch ? `Latch${w > 1 ? `, ${bitsOf(w)}` : ""}` : `Flip-flop${w > 1 ? `, ${bitsOf(w)}` : ""}`);
      out.push(latch ? TIP.latch : TIP.dff);
      if (node.pins.some((p) => p.id === "EN")) out.push("EN: updates only while the enable is 1.");
      if (node.info?.["reset"]) out.push(`R: reset is ${node.info["reset"]}.`);
      if (node.info?.["states"]) out.push(`Holds the FSM state. Named states: ${node.info["states"]}.`);
      break;
    }
    case "arith":
    case "compare":
    case "shift": {
      const op = node.op ?? node.kind;
      out.push(`${node.label || op.toUpperCase()}${w > 1 ? `, ${bitsOf(w)}` : ""}`);
      out.push(ARITH[op] ?? `${node.kind} ${op}.`);
      break;
    }
    case "const":
      out.push(`Constant ${node.label}`);
      out.push(`A fixed value from your code: ${node.label}.`);
      break;
    case "instance":
      out.push(node.label);
      out.push(`${TIP.instance} Module: ${node.moduleType ?? "?"}.`);
      break;
    case "blackbox":
      out.push(node.label);
      out.push(`${TIP.blackbox} Module: ${node.moduleType ?? "?"}.`);
      break;
    case "split":
      out.push(`Split, ${bitsOf(w)} in`);
      out.push(`${TIP.split} Bits taken: ${ripperPins(node)}.`);
      break;
    case "join":
      out.push(`Join, ${bitsOf(w)} out`);
      out.push(`${TIP.join} Top to bottom: ${ripperPins(node)}.`);
      break;
    case "cloud":
      out.push(node.info?.["expression"] ?? node.label);
      out.push(node.info?.["kind"] === "sequential" ? "An always block with a clock, drawn as a box until synthesis turns it into flip-flops and gates." : TIP.cloud);
      if (node.info?.["sensitivity"]) out.push(`Runs on ${node.info["sensitivity"]}.`);
      break;
    default:
      out.push(node.label || node.kind);
      out.push(`A Yosys cell this viewer does not draw in detail (${node.op ?? node.kind}).`);
  }
  if (node.warnings) {
    for (const warning of node.warnings) {
      if (warning === "latch" && node.kind === "dff") continue;
      out.push(`Warning: ${warning}.`);
    }
  }
  return out;
}

export function nodeTooltip(node: Node, lines: SourceLines): string {
  return [...nodeTooltipLines(node), fromLine(node.src, lines)].filter((l) => l !== "").join("\n");
}

export function portTooltip(port: Port, label: string, lines: SourceLines): string {
  const width = port.width > 0 ? port.width : 0;
  const note = port.ghost === "added" ? "Added in the newer text, not synthesized yet." : port.ghost === "removed" ? "Removed in the newer text." : port.ghost === "changed" ? "Changed in the newer text." : port.tentative ? "Recovered from broken text, so it may be wrong." : "";
  const undriven = port.undriven ? `It is not driven yet: nothing in the module writes ${port.name}. Add assign ${port.name} = ...; or an always block.` : "";
  const dir = port.direction === "input" ? TIP.input : port.direction === "output" ? TIP.output : TIP.inout;
  const bits = width > 1 ? TIP.bus(width) : width === 1 ? TIP.wire : "Width unknown until the file parses.";
  return [`${port.direction} ${label}`, dir, bits, note, undriven, fromLine(port.src, lines)].filter((l) => l !== "").join("\n");
}

export function netTooltip(net: Net | undefined, netId: string, lines: SourceLines): string {
  if (!net) return `${netId}\n${TIP.wire}`;
  const name = `${net.name ?? net.id}${net.aliases && net.aliases.length > 0 ? ` (also ${net.aliases.join(", ")})` : ""}`;
  const out = [name, net.width > 1 ? TIP.bus(net.width) : TIP.wire];
  if (net.role === "clock") out.push("This is the clock: every flip-flop it reaches updates on its edge.");
  if (net.role === "reset") out.push("This is a reset: it forces flip-flops back to their reset value.");
  for (const w of net.warnings ?? []) out.push(`Warning: ${w}.`);
  out.push(fromLine(net.src, lines));
  return out.filter((l) => l !== "").join("\n");
}

/** Tooltip for a labelled pin on a symbol (EN, R, S, D, Q, select). */
export function pinTooltip(node: Node, pinId: string, label: string): string | undefined {
  if (node.kind === "dff") {
    if (pinId === "CLK") return TIP.clock;
    if (pinId === "EN") return TIP.enable;
    if (pinId === "R") return `${TIP.reset}${node.info?.["reset"] ? ` (${node.info["reset"]})` : ""}`;
    if (pinId === "D") return "D: the value to store on the next clock edge.";
    if (pinId === "Q") return "Q: the stored value.";
    if (pinId === "SET") return "Set: forces the stored value to 1.";
    if (pinId === "CLR") return "Clear: forces the stored value to 0.";
  }
  if ((node.kind === "mux" || node.kind === "pmux") && pinId === "S") return TIP.select;
  if ((node.kind === "mux" || node.kind === "pmux") && label !== "") return `Chosen when the select value is ${label}.`;
  return undefined;
}
