// Diagram simplification rules on a ModuleView. Each rule is switchable and unit tested.
import type { ModuleView, Net, Node, Pin } from "./types";

export interface SimplifyOptions {
  /** Merge chains of the same associative 1-bit gate into one n-input gate */
  mergeChains: boolean;
  /** Drop $buf/$pos nodes, connecting their input through */
  dropBuffers: boolean;
  /** Turn a NOT feeding one gate into an inversion bubble; a gate feeding only a NOT gets an output bubble (and->nand ...) */
  bubbles: boolean;
}

export const DEFAULT_SIMPLIFY: SimplifyOptions = { mergeChains: true, dropBuffers: true, bubbles: true };

const ASSOCIATIVE = new Set(["and", "or", "xor"]);
const OUTPUT_INVERSION: Record<string, string> = { and: "nand", or: "nor", xor: "xnor", nand: "and", nor: "or", xnor: "xor" };

class Graph {
  nodes: Map<string, Node>;
  nets: Map<string, Net>;
  constructor(view: ModuleView) {
    this.nodes = new Map(view.nodes.map((n) => [n.id, structuredClone(n)]));
    this.nets = new Map(view.nets.map((n) => [n.id, structuredClone(n)]));
  }
  outPin(n: Node): Pin | undefined {
    return n.pins.find((p) => p.direction === "out");
  }
  inPins(n: Node): Pin[] {
    return n.pins.filter((p) => p.direction === "in");
  }
  netOf(pin: Pin): Net | undefined {
    return pin.net ? this.nets.get(pin.net) : undefined;
  }
  removeNode(id: string): void {
    this.nodes.delete(id);
  }
  removeNet(id: string): void {
    this.nets.delete(id);
  }
  /** Re-point a sink end to a different net. */
  moveSink(net: Net, from: { node: string; pin: string }, to: Net): void {
    net.sinks = net.sinks.filter((s) => !(s.node === from.node && s.pin === from.pin));
    to.sinks.push(from);
  }
  toView(view: ModuleView): ModuleView {
    return { ...view, nodes: [...this.nodes.values()], nets: [...this.nets.values()] };
  }
}

/** Logical operators (&&, ||, !) never merge with or bubble into bitwise gates. */
function isLogical(n: Node): boolean {
  return n.info?.["logical"] !== undefined;
}

function isUnnamedSingleSink(net: Net | undefined): net is Net {
  return net !== undefined && net.name === undefined && net.sinks.length === 1 && !net.sinks[0]!.node.startsWith("port:");
}

/** p1a & p1b & p1c -> one 3-input AND. */
export function mergeChains(view: ModuleView): ModuleView {
  const g = new Graph(view);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of [...g.nodes.values()]) {
      if (n.kind !== "gate" || !n.op || !ASSOCIATIVE.has(n.op) || n.width !== 1) continue;
      const out = g.outPin(n);
      if (!out) continue;
      const net = g.netOf(out);
      if (!isUnnamedSingleSink(net)) continue;
      const sinkEnd = net.sinks[0]!;
      const sink = g.nodes.get(sinkEnd.node);
      if (!sink || sink.kind !== "gate" || sink.op !== n.op || sink.width !== 1) continue;
      if (isLogical(sink) !== isLogical(n)) continue;
      const sinkPin = sink.pins.find((p) => p.id === sinkEnd.pin);
      if (!sinkPin || sinkPin.inverted) continue;
      // Replace sinkPin with n's input pins (keeping order: n's inputs where the pin was).
      const idx = sink.pins.indexOf(sinkPin);
      const moved: Pin[] = g.inPins(n).map((p, i) => ({ ...p, id: `${sinkPin.id}_${i}` }));
      for (const p of moved) {
        const pn = g.netOf(p);
        if (pn) {
          pn.sinks = pn.sinks.filter((s) => !(s.node === n.id));
          pn.sinks.push({ node: sink.id, pin: p.id });
        }
      }
      sink.pins.splice(idx, 1, ...moved);
      // Renumber input pins so ids stay unique and ordered.
      let k = 0;
      for (const p of sink.pins) {
        if (p.direction !== "in" || p.side !== "west") continue;
        const newId = `I${k++}`;
        const pn = g.netOf(p);
        if (pn) for (const s of pn.sinks) if (s.node === sink.id && s.pin === p.id) s.pin = newId;
        p.id = newId;
      }
      sink.src = [...sink.src, ...n.src.filter((s) => !sink.src.some((t) => t.line === s.line && t.column === s.column))];
      g.removeNet(net.id);
      g.removeNode(n.id);
      changed = true;
      break;
    }
  }
  return g.toView(view);
}

/** Remove buffer gates by connecting their input net through to the sinks. */
export function dropBuffers(view: ModuleView): ModuleView {
  const g = new Graph(view);
  for (const n of [...g.nodes.values()]) {
    if (n.kind !== "gate" || n.op !== "buf") continue;
    const inPin = g.inPins(n)[0];
    const out = g.outPin(n);
    if (!inPin || !out) continue;
    const inNet = g.netOf(inPin);
    const outNet = g.netOf(out);
    if (!inNet || !outNet) continue;
    if (outNet.name !== undefined && inNet.name !== undefined) continue; // keep user-visible renames
    inNet.sinks = inNet.sinks.filter((s) => s.node !== n.id);
    for (const s of outNet.sinks) {
      inNet.sinks.push(s);
      const sinkNode = g.nodes.get(s.node);
      const sp = sinkNode?.pins.find((p) => p.id === s.pin);
      if (sp) sp.net = inNet.id;
    }
    if (outNet.name !== undefined && inNet.name === undefined) inNet.name = outNet.name;
    g.removeNet(outNet.id);
    g.removeNode(n.id);
  }
  return g.toView(view);
}

/** Inversion bubbles: NOT -> single gate input becomes an inverted pin; gate -> only a NOT becomes an inverted output op. */
export function bubbles(view: ModuleView): ModuleView {
  const g = new Graph(view);
  // Output bubbles first (gate whose only sink is a NOT).
  for (const n of [...g.nodes.values()]) {
    if (n.kind !== "gate" || !n.op || OUTPUT_INVERSION[n.op] === undefined || isLogical(n)) continue;
    const out = g.outPin(n);
    if (!out) continue;
    const net = g.netOf(out);
    if (!isUnnamedSingleSink(net)) continue;
    const notNode = g.nodes.get(net.sinks[0]!.node);
    if (!notNode || notNode.kind !== "gate" || notNode.op !== "not" || notNode.width !== n.width || isLogical(notNode)) continue;
    const notOut = g.outPin(notNode);
    const notOutNet = notOut ? g.netOf(notOut) : undefined;
    if (!notOutNet) continue;
    n.op = OUTPUT_INVERSION[n.op]!;
    n.label = n.op.toUpperCase();
    n.src = [...n.src, ...notNode.src];
    // The gate now drives the NOT's output net.
    notOutNet.driver = { node: n.id, pin: out.id };
    out.net = notOutNet.id;
    g.removeNet(net.id);
    g.removeNode(notNode.id);
  }
  // Input bubbles (NOT whose only sink is a gate input, or a dff/mux/arith input).
  for (const n of [...g.nodes.values()]) {
    if (n.kind !== "gate" || n.op !== "not" || isLogical(n)) continue;
    const inPin = g.inPins(n)[0];
    const out = g.outPin(n);
    if (!inPin || !out) continue;
    const inNet = g.netOf(inPin);
    const outNet = g.netOf(out);
    if (!inNet || !isUnnamedSingleSink(outNet)) continue;
    const sinkEnd = outNet.sinks[0]!;
    const sink = g.nodes.get(sinkEnd.node);
    if (!sink || !(sink.kind === "gate" || sink.kind === "reduce") || isLogical(sink)) continue;
    const sp = sink.pins.find((p) => p.id === sinkEnd.pin);
    if (!sp || sp.inverted) continue;
    sp.inverted = true;
    sp.net = inNet.id;
    inNet.sinks = inNet.sinks.filter((s) => s.node !== n.id);
    inNet.sinks.push(sinkEnd);
    sink.src = [...sink.src, ...n.src];
    g.removeNet(outNet.id);
    g.removeNode(n.id);
  }
  return g.toView(view);
}

export function simplifyModule(view: ModuleView, opts: SimplifyOptions = DEFAULT_SIMPLIFY): ModuleView {
  let v = view;
  if (opts.dropBuffers) v = dropBuffers(v);
  if (opts.bubbles) v = bubbles(v);
  if (opts.mergeChains) v = mergeChains(v);
  return v;
}
