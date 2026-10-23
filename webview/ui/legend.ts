// Legend panel (bug 18): every symbol the renderer draws, drawn with the same symbol
// code, each with its one-sentence meaning.
import type { Node, NodeKind, Pin } from "../../src/ir/types";
import { junctionRadius, nodeSize } from "../render/geometry";
import { ALL_ZERO, ANY_ONE } from "../render/logical";
import { fmt, portShapePath } from "../render/svg";
import { symbolMarkup, type PinPos } from "../render/symbols";
import { TIP } from "../render/tooltips";

export interface LegendItem {
  key: string;
  title: string;
  text: string;
  /** Inner SVG markup for a small sample, in a viewBox of `width` by `height` */
  svg: string;
  width: number;
  height: number;
  /** Node kinds this sample stands for (the legend must cover every NodeKind) */
  kinds: NodeKind[];
}

const PAD = 12;

function pin(id: string, direction: "in" | "out", side: Pin["side"], width = 1, extra: Partial<Pin> = {}): Pin {
  return { id, label: "", direction, side, width, net: null, ...extra };
}

/** Lays a node out on its own: west pins down the left edge, east pins down the right, south pins along the bottom. */
function sample(node: Node): { svg: string; width: number; height: number } {
  const size = nodeSize(node);
  const pins: PinPos = new Map();
  const bySide = (side: Pin["side"]): Pin[] => node.pins.filter((p) => p.side === side);
  const top = node.kind === "instance" || node.kind === "blackbox" || node.kind === "unknown" || node.kind === "dff" ? 18 : 0;
  for (const side of ["west", "east"] as const) {
    const list = bySide(side);
    const h = size.height - top - (node.kind === "gate" && node.info?.["logical"] === "1" ? 10 : 0);
    list.forEach((p, i) => pins.set(p.id, { x: side === "west" ? 0 : size.width, y: top + (h * (i + 1)) / (list.length + 1), pin: p }));
  }
  bySide("south").forEach((p, i, list) => pins.set(p.id, { x: (size.width * (i + 1)) / (list.length + 1), y: size.height, pin: p }));
  const stubs = [...pins.values()]
    .map((p) => (p.pin.side === "west" ? `<path class="net-path" d="M${fmt(p.x - PAD)},${fmt(p.y)} H${fmt(p.x)}"/>` : p.pin.side === "east" ? `<path class="net-path" d="M${fmt(p.x)},${fmt(p.y)} H${fmt(p.x + PAD)}"/>` : `<path class="net-path" d="M${fmt(p.x)},${fmt(p.y)} V${fmt(p.y + PAD)}"/>`))
    .join("");
  const cls = `node node-${node.kind}${node.op ? ` op-${node.op}` : ""}`;
  return {
    svg: `<g class="nets">${stubs}</g><g class="nodes"><g class="${cls}" data-kind="${node.kind}">${symbolMarkup(node, size.width, size.height, pins)}</g></g>`,
    width: size.width + 2 * PAD,
    height: size.height + PAD,
  };
}

function nodeItem(key: string, title: string, text: string, node: Node, kinds: NodeKind[]): LegendItem {
  const s = sample(node);
  return { key, title, text, svg: `<g transform="translate(${PAD},2)">${s.svg}</g>`, width: s.width, height: s.height, kinds };
}

function gate(op: string, inputs = 2, width = 1, info?: Record<string, string>): Node {
  const pins = [...Array.from({ length: inputs }, (_, i) => pin(String.fromCharCode(65 + i), "in", "west", width)), pin("Y", "out", "east", width)];
  return { id: `legend:${op}`, kind: "gate", op, width, pins, label: op.toUpperCase(), src: [], ...(info ? { info } : {}) };
}

export function legendItems(): LegendItem[] {
  const portW = 40;
  const portH = 20;
  const items: LegendItem[] = [
    {
      key: "input",
      title: "Input port",
      text: TIP.input,
      svg: `<g class="nodes"><g class="port port-input"><path class="port-shape" d="${portShapePath("input", portW, portH)}"/><text class="port-label" x="6" y="10" dominant-baseline="central">a</text></g></g><g class="nets"><path class="net-path" d="M${portW},10 H${portW + PAD}"/></g>`,
      width: portW + PAD,
      height: portH,
      kinds: [],
    },
    {
      key: "output",
      title: "Output port",
      text: TIP.output,
      svg: `<g class="nets"><path class="net-path" d="M0,10 H${PAD}"/></g><g class="nodes"><g class="port port-output" transform="translate(${PAD},0)"><path class="port-shape" d="${portShapePath("output", portW, portH)}"/><text class="port-label" x="${portW - 6}" y="10" text-anchor="end" dominant-baseline="central">y</text></g></g>`,
      width: portW + PAD,
      height: portH,
      kinds: [],
    },
    { key: "wire", title: "Wire", text: TIP.wire, svg: `<g class="nets"><g class="net"><path class="net-path" d="M0,10 H60"/></g></g>`, width: 60, height: 20, kinds: [] },
    {
      key: "bus",
      title: "Bus",
      text: TIP.bus(8).replace("8", "N"),
      svg: `<g class="nets"><g class="net bus"><path class="net-path" d="M0,14 H60"/><path class="bus-slash" d="M27,18 L33,10"/><text class="bus-width" x="34" y="11">8</text></g></g>`,
      width: 60,
      height: 22,
      kinds: [],
    },
    {
      key: "junction",
      title: "Junction dot",
      text: TIP.junction,
      svg: `<g class="nets"><g class="net"><path class="net-path" d="M0,12 H60 M30,12 V28"/><circle class="junction" cx="30" cy="12" r="${fmt(junctionRadius(1))}"/></g></g>`,
      width: 60,
      height: 30,
      kinds: [],
    },
    {
      key: "crossing",
      title: "Plain crossing",
      text: TIP.crossing,
      svg: `<g class="nets"><g class="net"><path class="net-path" d="M0,14 H60"/></g><g class="net"><path class="net-path" d="M30,0 V28"/></g></g>`,
      width: 60,
      height: 30,
      kinds: [],
    },
    nodeItem("and", "AND gate", "Output is 1 only when every input is 1.", gate("and"), ["gate"]),
    nodeItem("or", "OR gate", "Output is 1 when any input is 1.", gate("or"), ["gate"]),
    nodeItem("xor", "XOR gate", "Output is 1 when the inputs differ.", gate("xor"), ["gate"]),
    nodeItem("not", "NOT gate and inversion bubble", TIP.bubble, gate("not", 1), ["gate"]),
    nodeItem("bitwise", "Bitwise gate on a bus", TIP.bitwise, gate("and", 2, 4), ["gate"]),
    nodeItem("logical", "Logical gate", TIP.logical, gate("or", 2, 1, { logical: "1" }), ["gate"]),
    nodeItem("any", `${ANY_ONE} box`, TIP.anyOne, { id: "legend:any", kind: "reduce", op: "or", width: 4, pins: [pin("A", "in", "west", 4), pin("Y", "out", "east")], label: ANY_ONE, src: [], info: { logical: "1", reduceLabel: ANY_ONE } }, ["reduce"]),
    nodeItem("all0", `${ALL_ZERO} box`, TIP.allZero, { id: "legend:all0", kind: "reduce", op: "nor", width: 4, pins: [pin("A", "in", "west", 4), pin("Y", "out", "east")], label: ALL_ZERO, src: [], info: { logical: "1", reduceLabel: ALL_ZERO } }, ["reduce"]),
    nodeItem("reduce", "Reduce gate", "Combines every bit of one bus into one bit (here with OR).", { id: "legend:reduce", kind: "reduce", op: "or", width: 4, pins: [pin("A", "in", "west", 4), pin("Y", "out", "east")], label: "|", src: [] }, ["reduce"]),
    nodeItem("mux", "Mux", TIP.mux, { id: "legend:mux", kind: "mux", width: 1, pins: [pin("A", "in", "west", 1, { label: "0" }), pin("B", "in", "west", 1, { label: "1" }), pin("S", "in", "south"), pin("Y", "out", "east")], label: "MUX", src: [] }, ["mux", "pmux"]),
    nodeItem("dff", "Flip-flop", TIP.dff, { id: "legend:dff", kind: "dff", op: "dff", width: 1, pins: [pin("D", "in", "west", 1, { label: "D" }), pin("CLK", "in", "south"), pin("Q", "out", "east", 1, { label: "Q" })], label: "DFF", src: [] }, ["dff"]),
    nodeItem("latch", "Latch (warning)", TIP.latch, { id: "legend:latch", kind: "dff", op: "dlatch", width: 1, pins: [pin("D", "in", "west", 1, { label: "D" }), pin("EN", "in", "west", 1, { label: "EN" }), pin("Q", "out", "east", 1, { label: "Q" })], label: "LATCH", src: [], warnings: ["latch"] }, ["dff"]),
    nodeItem("arith", "Arithmetic, compare and shift boxes", "Adders, subtractors, comparators and shifters show their operator.", { id: "legend:add", kind: "arith", op: "add", width: 4, pins: [pin("A", "in", "west", 4), pin("B", "in", "west", 4), pin("Y", "out", "east", 4)], label: "+", src: [] }, ["arith", "compare", "shift"]),
    nodeItem("const", "Constant", TIP.constant, { id: "legend:const", kind: "const", width: 1, pins: [pin("Y", "out", "east")], label: "1'b0", src: [] }, ["const"]),
    nodeItem("join", "Join bar", TIP.join, { id: "legend:join", kind: "join", width: 6, pins: [pin("in1", "in", "west", 3, { bits: "[5:3]" }), pin("in0", "in", "west", 3, { bits: "[2:0]" }), pin("out", "out", "east", 6)], label: "", src: [] }, ["join"]),
    nodeItem("split", "Split bar", TIP.split, { id: "legend:split", kind: "split", width: 6, pins: [pin("in", "in", "west", 6), pin("hi", "out", "east", 3, { bits: "[5:3]" }), pin("lo", "out", "east", 3, { bits: "[2:0]" })], label: "", src: [] }, ["split"]),
    nodeItem("instance", "Module instance", TIP.instance, { id: "legend:inst", kind: "instance", width: 1, pins: [pin("a", "in", "west", 1, { label: "a" }), pin("y", "out", "east", 1, { label: "y" })], label: "u1 : add16", src: [], moduleType: "add16" }, ["instance"]),
    nodeItem("blackbox", "Black box", TIP.blackbox, { id: "legend:bb", kind: "blackbox", width: 1, pins: [pin("a", "in", "west", 1, { label: "a" }), pin("y", "out", "east", 1, { label: "y" })], label: "u2 : my_dff", src: [], moduleType: "my_dff" }, ["blackbox"]),
    nodeItem("cloud", "Logic cloud", TIP.cloud, { id: "legend:cloud", kind: "cloud", width: 1, pins: [pin("a", "in", "west"), pin("y", "out", "east")], label: "y = a & b", src: [] }, ["cloud"]),
    nodeItem("unknown", "Other cell", "A Yosys cell this viewer does not draw in detail; the tooltip names it.", { id: "legend:unknown", kind: "unknown", width: 1, pins: [pin("A", "in", "west"), pin("Y", "out", "east")], label: "$cell", src: [] }, ["unknown"]),
    {
      key: "warning",
      title: "Warning on a wire",
      text: "Something to check: the tooltip says what (for example two drivers on one wire, or a loop).",
      svg: `<g class="nets"><g class="net warn"><path class="net-path" d="M0,20 H60"/><g class="warn"><path class="warn-badge" d="M30,7 L36,17 L24,17 Z"/><text class="warn-badge-text" x="30" y="16" text-anchor="middle">!</text></g></g></g>`,
      width: 60,
      height: 24,
      kinds: [],
    },
  ];
  return items;
}
