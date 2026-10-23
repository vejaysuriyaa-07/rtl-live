// Drawing of logical operators (bug 17). The IR keeps `a || b` as one gate with bus
// inputs and a 1-bit output; the drawing shows what really happens: each bus input goes
// through an "any 1?" box (OR of all bits), and the 1-bit results feed a plain 1-bit gate.
// `!a` on a bus is one "all 0?" box. 1-bit inputs keep the plain gate with a "logical" tag.
// This is a presentation transform: the IR, the export and the L2 checks stay unchanged.
import type { ModuleView, Net, Node, Pin } from "../../src/ir/types";

export const ANY_ONE = "any 1?";
export const ALL_ZERO = "all 0?";

function isLogical(node: Node): boolean {
  return node.kind === "gate" && node.info?.["logical"] === "1";
}

/** True for the boxes this transform adds (and for a `!` that became one). */
export function isReduceBox(node: Node): boolean {
  return node.kind === "reduce" && node.info?.["logical"] === "1";
}

export function expandLogicalGates(view: ModuleView): ModuleView {
  if (!view.nodes.some((n) => isLogical(n) && n.pins.some((p) => p.direction === "in" && p.width > 1))) return view;
  const nodes: Node[] = [];
  const nets: Net[] = view.nets.map((n) => ({ ...n, sinks: [...n.sinks] }));
  const netById = new Map(nets.map((n) => [n.id, n] as const));
  for (const node of view.nodes) {
    const wide = isLogical(node) ? node.pins.filter((p) => p.direction === "in" && p.width > 1) : [];
    if (wide.length === 0) {
      nodes.push(node);
      continue;
    }
    if (node.op === "not" && node.pins.filter((p) => p.direction === "in").length === 1) {
      // `!a`: the gate itself becomes the "all 0?" box.
      nodes.push({ ...node, kind: "reduce", op: "nor", label: ALL_ZERO, info: { ...node.info, logical: "1", reduceLabel: ALL_ZERO } });
      continue;
    }
    const pins: Pin[] = node.pins.map((p) => ({ ...p }));
    for (const pin of pins) {
      if (pin.direction !== "in" || pin.width <= 1) continue;
      const boxId = `${node.id}.any:${pin.id}`;
      const oneBit = `net:${boxId}.Y`;
      const input = pin.net ? netById.get(pin.net) : undefined;
      if (input) {
        const idx = input.sinks.findIndex((s) => s.node === node.id && s.pin === pin.id);
        if (idx >= 0) input.sinks[idx] = { node: boxId, pin: "A" };
      }
      nodes.push({
        id: boxId,
        kind: "reduce",
        op: "or",
        width: pin.width,
        pins: [
          { id: "A", label: "", direction: "in", side: "west", width: pin.width, net: pin.net },
          { id: "Y", label: "", direction: "out", side: "east", width: 1, net: oneBit },
        ],
        label: ANY_ONE,
        src: node.src,
        info: { logical: "1", reduceLabel: ANY_ONE, operand: pin.id },
      });
      nets.push({ id: oneBit, width: 1, driver: { node: boxId, pin: "Y" }, sinks: [{ node: node.id, pin: pin.id }], src: node.src });
      pin.net = oneBit;
      pin.width = 1;
    }
    nodes.push({ ...node, pins });
  }
  return { ...view, nodes, nets };
}
