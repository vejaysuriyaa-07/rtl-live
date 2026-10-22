// RTL view shaping (ACCURACY.md section 2): a case statement on one selector
// comes out of Yosys as a $pmux whose one-hot select bits are $eq(sel, k)
// cells (plus $logic_not(sel) for 0, or the bit itself and $not for a 1-bit
// selector). Here that becomes one N:1 mux whose inputs are labelled with the
// select values, the selector net enters the S pin directly, the comparator
// cells go away, and a "default" input that is undefined (x) is dropped when
// every value is covered.
import type { ModuleView, Net, Node, Pin } from "./types";

interface Resolved {
  selector: string;
  value: number;
  helpers: string[];
}

function constValue(label: string): number | undefined {
  const m = /^(\d+)'([bhd])([0-9a-fA-F_]+)$/.exec(label);
  if (!m) return undefined;
  const digits = m[3]!.replace(/_/g, "");
  const radix = m[2] === "b" ? 2 : m[2] === "h" ? 16 : 10;
  const v = parseInt(digits, radix);
  return Number.isFinite(v) ? v : undefined;
}

function isAllX(label: string): boolean {
  return /^\d+'b[xX]+$/.test(label) || /^\d+'[hd][xX]+$/.test(label);
}

export function rtlView(view: ModuleView): ModuleView {
  const nodes = new Map(view.nodes.map((n) => [n.id, structuredClone(n)]));
  const nets = new Map(view.nets.map((n) => [n.id, structuredClone(n)]));
  const driverOf = (netId: string | null): Node | undefined => {
    if (!netId) return undefined;
    const net = nets.get(netId);
    return net?.driver ? nodes.get(net.driver.node) : undefined;
  };
  const inPin = (n: Node, id: string): Pin | undefined => n.pins.find((p) => p.id === id);
  const constOf = (netId: string | null): string | undefined => {
    const d = driverOf(netId);
    return d && d.kind === "const" ? (d.info?.["value"] ?? d.label) : undefined;
  };

  /** One select bit: which selector net and which value makes it true. */
  const resolveBit = (netId: string): Resolved | undefined => {
    const net = nets.get(netId);
    if (!net) return undefined;
    const d = driverOf(netId);
    if (d && d.kind === "compare" && d.op === "eq") {
      const a = inPin(d, "A");
      const b = inPin(d, "B");
      if (!a?.net || !b?.net) return undefined;
      const cb = constOf(b.net);
      const ca = constOf(a.net);
      if (cb !== undefined && ca === undefined) {
        const v = constValue(cb);
        return v === undefined ? undefined : { selector: a.net, value: v, helpers: [d.id, nets.get(b.net)!.driver!.node] };
      }
      if (ca !== undefined && cb === undefined) {
        const v = constValue(ca);
        return v === undefined ? undefined : { selector: b.net, value: v, helpers: [d.id, nets.get(a.net)!.driver!.node] };
      }
      return undefined;
    }
    if (d && d.kind === "gate" && d.op === "not") {
      // !sel (any width) or ~sel (1 bit): true when the selector is 0.
      const a = inPin(d, "A");
      if (!a?.net) return undefined;
      const sel = nets.get(a.net);
      if (!sel) return undefined;
      if (d.info?.["logical"] === undefined && sel.width !== 1) return undefined;
      return { selector: a.net, value: 0, helpers: [d.id] };
    }
    // The selector bit itself (1-bit case): true when it is 1.
    if (net.width === 1 && !(d && (d.kind === "join" || d.kind === "split"))) return { selector: netId, value: 1, helpers: [] };
    return undefined;
  };

  for (const mux of [...nodes.values()]) {
    if (mux.kind !== "pmux" || mux.label !== "PMUX") continue;
    const sPin = inPin(mux, "S");
    if (!sPin?.net) continue;
    const cases = mux.pins.filter((p) => /^B\d+$/.test(p.id)).sort((p, q) => Number(p.id.slice(1)) - Number(q.id.slice(1)));
    // Select bits, LSB first: either one net per bit through a join, or a single 1-bit net.
    let bitNets: string[] | undefined;
    const sDriver = driverOf(sPin.net);
    if (sDriver && sDriver.kind === "join") {
      const ins = sDriver.pins.filter((p) => p.direction === "in");
      const ordered = ins
        .map((p) => ({ p, idx: Number(/^\[(\d+)\]$/.exec(p.bits ?? "")?.[1] ?? NaN) }))
        .sort((a, b) => a.idx - b.idx);
      if (ordered.some((o) => Number.isNaN(o.idx) || o.p.width !== 1 || !o.p.net)) continue;
      bitNets = ordered.map((o) => o.p.net!);
    } else if (sPin.width === 1 && cases.length === 1) {
      bitNets = [sPin.net];
    }
    if (!bitNets || bitNets.length !== cases.length) continue;
    const resolved = bitNets.map(resolveBit);
    if (resolved.some((r) => r === undefined)) continue;
    const rs = resolved as Resolved[];
    const selector = rs[0]!.selector;
    if (!rs.every((r) => r.selector === selector)) continue;
    const selNet = nets.get(selector);
    if (!selNet) continue;
    const values = new Set(rs.map((r) => r.value));
    if (values.size !== rs.length) continue;

    // Rebuild the pins: cases by value, A as "default" or the one uncovered value, S on the selector.
    const aPin = inPin(mux, "A");
    const dataWidth = cases[0]?.width ?? mux.width;
    const total = 2 ** selNet.width;
    const covered = [...values].sort((x, y) => x - y);
    const missing = selNet.width <= 16 ? [...Array(total).keys()].filter((v) => !values.has(v)) : [];
    const aConst = aPin?.net ? constOf(aPin.net) : undefined;
    const dropA = aPin !== undefined && (aPin.net === null || (aConst !== undefined && isAllX(aConst)) || missing.length === 0);
    const newPins: Pin[] = [];
    const byValue = new Map<number, Pin>();
    rs.forEach((r, i) => byValue.set(r.value, cases[i]!));
    for (const v of covered) {
      const p = byValue.get(v)!;
      newPins.push({ ...p, id: `B${newPins.length}`, label: String(v) });
    }
    if (aPin && !dropA) {
      newPins.push({ ...aPin, id: "A", label: missing.length === 1 ? String(missing[0]) : "default" });
    }
    // Re-point the sinks of the data nets to the renamed pins.
    for (const p of newPins) {
      if (!p.net) continue;
      const net = nets.get(p.net);
      if (!net) continue;
      const old = mux.pins.find((q) => q.net === p.net && q.direction === "in" && q.id !== "S" && !newPins.some((x) => x !== p && x.id === q.id));
      for (const s of net.sinks) if (s.node === mux.id && (s.pin === old?.id || mux.pins.some((q) => q.id === s.pin && q.net === p.net))) s.pin = p.id;
    }
    if (aPin && dropA && aPin.net) {
      const n = nets.get(aPin.net);
      if (n) n.sinks = n.sinks.filter((s) => !(s.node === mux.id && s.pin === "A"));
      const d = driverOf(aPin.net);
      if (d && d.kind === "const" && n && n.sinks.length === 0) {
        nodes.delete(d.id);
        nets.delete(n.id);
      }
    }
    newPins.push({ ...sPin, net: selector, width: selNet.width, label: "" });
    const yPin = mux.pins.find((p) => p.direction === "out")!;
    newPins.push(yPin);
    mux.pins = newPins;
    mux.width = dataWidth;
    mux.info = { ...(mux.info ?? {}), select: "value", selector: selNet.name ?? selector };
    // The selector net now feeds the mux directly.
    const oldS = nets.get(sPin.net);
    if (oldS) oldS.sinks = oldS.sinks.filter((s) => s.node !== mux.id);
    selNet.sinks.push({ node: mux.id, pin: "S" });
    // Drop the helper cells (join, comparators, constants, nots) and their private nets.
    const helpers = new Set<string>([...rs.flatMap((r) => r.helpers), ...(sDriver && sDriver.kind === "join" ? [sDriver.id] : [])]);
    for (const id of helpers) {
      const h = nodes.get(id);
      if (!h) continue;
      // Only remove a helper whose outputs feed nothing else.
      const outs = h.pins.filter((p) => p.direction === "out" && p.net);
      const busy = outs.some((p) => {
        const n = nets.get(p.net!);
        return n && n.sinks.some((s) => !helpers.has(s.node) && s.node !== mux.id);
      });
      if (busy) continue;
      for (const p of h.pins) {
        if (!p.net) continue;
        const n = nets.get(p.net);
        if (!n) continue;
        if (p.direction === "out") nets.delete(n.id);
        else n.sinks = n.sinks.filter((s) => s.node !== id);
      }
      nodes.delete(id);
    }
    // A selector bit that fed only the join keeps its net (it is the selector itself).
    for (const [id, n] of nets) if (n.driver === null && n.sinks.length === 0 && n.name === undefined) nets.delete(id);
  }
  return { ...view, nodes: [...nodes.values()], nets: [...nets.values()] };
}

export type { Net };
