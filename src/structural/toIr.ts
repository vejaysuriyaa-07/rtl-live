// Structural model -> SchematicDoc with fidelity "structural".
// Module box with ports, instance boxes, named nets, and dashed logic clouds
// for assigns and always blocks.
import {
  IR_VERSION,
  type Diagnostic,
  type ModuleView,
  type Net,
  type NetEnd,
  type Node,
  type Pin,
  type Port,
  type SchematicDoc,
  type SrcRange,
} from "../ir/types";
import type { SAssign, SConnection, SInstance, SModule, StructuralFile } from "./types";
import { literalWidth, selectWidth } from "./width";
import { annotateSemantics } from "../ir/semantics";
import { parseLvalue } from "./lvalues";

export interface ToIrOptions {
  sourceUri: string;
  generation: number;
  top: string;
  /** Max characters of expression text on a cloud label */
  labelLength?: number;
}

const CLOUD_LABEL = 28;

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

interface SymbolInfo {
  width: number;
  range?: string;
  src: SrcRange;
  kind: "input" | "output" | "inout" | "wire" | "reg" | "logic" | "other";
}

class NetTable {
  readonly nets = new Map<string, Net>();
  constructor(private readonly symbols: Map<string, SymbolInfo>) {}

  get(name: string, srcHint?: SrcRange): Net {
    let n = this.nets.get(name);
    if (!n) {
      const sym = this.symbols.get(name);
      n = {
        id: `net:${name}`,
        name,
        width: sym ? sym.width : 1,
        driver: null,
        sinks: [],
        src: sym ? [sym.src] : srcHint ? [srcHint] : [],
      };
      this.nets.set(name, n);
    }
    return n;
  }

  drive(name: string, end: NetEnd, srcHint?: SrcRange): void {
    const n = this.get(name, srcHint);
    if (n.driver === null) n.driver = end;
    else n.sinks.push(end); // multiple drivers: keep the diagram connected
  }

  sink(name: string, end: NetEnd, srcHint?: SrcRange): void {
    this.get(name, srcHint).sinks.push(end);
  }
}

function widthOfExpr(exprText: string, symbols: Map<string, SymbolInfo>): number {
  const t = exprText.trim();
  const lit = literalWidth(t);
  if (lit !== undefined) return lit;
  const sel = /^([A-Za-z_][\w$]*)\s*(\[[^\]]*\])\s*$/.exec(t);
  if (sel && sel[1] !== undefined && sel[2] !== undefined) {
    const w = selectWidth(sel[2]);
    if (w !== undefined) return w;
    return 1;
  }
  const sym = symbols.get(t);
  if (sym) return sym.width;
  return 1;
}

function buildSymbols(m: SModule): Map<string, SymbolInfo> {
  const symbols = new Map<string, SymbolInfo>();
  for (const p of m.ports) symbols.set(p.name, { width: p.width, ...(p.range !== undefined ? { range: p.range } : {}), src: p.src, kind: p.direction });
  for (const d of m.decls) {
    const prev = symbols.get(d.name);
    if (prev && (prev.kind === "input" || prev.kind === "output" || prev.kind === "inout")) {
      // output reg q: keep the port, maybe upgrade width
      if (prev.width <= 1 && d.width > 1) prev.width = d.width;
      continue;
    }
    symbols.set(d.name, { width: d.width, ...(d.range !== undefined ? { range: d.range } : {}), src: d.src, kind: d.kind });
  }
  return symbols;
}

function inferPinDirection(
  conn: SConnection,
  m: SModule,
  symbols: Map<string, SymbolInfo>,
  drivenElsewhere: Set<string>,
): "in" | "out" | "inout" {
  if (conn.isConst) return "in";
  if (conn.idents.length === 0) return "out"; // .cout()
  const ids = conn.idents;
  if (ids.some((id) => symbols.get(id)?.kind === "input")) return "in";
  if (ids.every((id) => symbols.get(id)?.kind === "output") && !ids.some((id) => drivenElsewhere.has(id))) return "out";
  if (ids.every((id) => !drivenElsewhere.has(id))) return "out";
  if (ids.some((id) => drivenElsewhere.has(id))) return "in";
  void m;
  return "inout";
}

function instanceNode(
  inst: SInstance,
  m: SModule,
  file: StructuralFile,
  symbols: Map<string, SymbolInfo>,
  nets: NetTable,
  ordinal: number,
  drivenElsewhere: Set<string>,
): Node {
  const defined = file.modules.find((x) => x.name === inst.moduleType);
  const id = `inst:${inst.name || `${inst.moduleType}#${ordinal}`}`;
  const pins: Pin[] = [];
  inst.connections.forEach((c) => {
    const pinId = c.port ?? `p${c.index}`;
    let direction: "in" | "out" | "inout";
    let width = widthOfExpr(c.exprText, symbols);
    const formal = defined?.ports.find((p) => p.name === c.port) ?? (c.port === undefined ? defined?.ports[c.index] : undefined);
    if (formal) {
      direction = formal.direction === "input" ? "in" : formal.direction === "output" ? "out" : "inout";
      if (formal.width > 0) width = formal.width;
    } else {
      direction = inferPinDirection(c, m, symbols, drivenElsewhere);
    }
    const net = c.idents.length === 1 && c.idents[0] !== undefined && /^[A-Za-z_][\w$]*$/.test(c.exprText.trim()) ? c.idents[0] : c.idents.length > 0 ? `expr:${inst.name}.${pinId}` : null;
    const pin: Pin = {
      id: pinId,
      label: c.port ?? `p${c.index}`,
      direction,
      side: direction === "out" ? "east" : "west",
      width,
      net: c.isConst ? `const:${inst.name}.${pinId}` : net,
    };
    pins.push(pin);
  });
  const label = `${inst.name} : ${inst.moduleType}`;
  const node: Node = {
    id,
    kind: defined ? "instance" : "blackbox",
    width: 1,
    pins,
    label,
    src: [inst.src],
    moduleType: inst.moduleType,
  };
  if (defined) node.drillTarget = defined.name;
  void nets;
  return node;
}

interface SliceWrite {
  assign: SAssign;
  netName: string;
  bits: string;
  width: number;
  msb: number;
  lsb: number;
}

interface SliceAssignNets {
  /** Signal name -> its slice writes, MSB first (the join's pin order) */
  bySignal: Map<string, SliceWrite[]>;
  byAssign: Map<SAssign, Map<string, SliceWrite>>;
}

/** Signals written only by two or more assigns, each to a literal slice, with no two slices overlapping. */
function sliceAssignNets(m: SModule, symbols: Map<string, SymbolInfo>): SliceAssignNets {
  const candidates = new Map<string, SliceWrite[]>();
  const whole = new Set<string>();
  for (const a of m.assigns) {
    const targets = parseLvalue(a.lhsText);
    for (const l of a.lhs) if (!targets.some((t) => t.name === l)) whole.add(l);
    for (const t of targets) {
      if (t.msb === undefined || t.lsb === undefined) {
        whole.add(t.name);
        continue;
      }
      const bits = t.msb === t.lsb ? `[${t.msb}]` : `[${t.msb}:${t.lsb}]`;
      const list = candidates.get(t.name) ?? candidates.set(t.name, []).get(t.name)!;
      list.push({ assign: a, netName: `${t.name}${bits}`, bits, width: t.msb - t.lsb + 1, msb: t.msb, lsb: t.lsb });
    }
  }
  for (const al of m.always) for (const l of al.assigned) whole.add(l);
  const bySignal = new Map<string, SliceWrite[]>();
  const byAssign = new Map<SAssign, Map<string, SliceWrite>>();
  for (const [name, list] of candidates) {
    if (list.length < 2 || whole.has(name) || !symbols.has(name)) continue;
    const sorted = [...list].sort((x, y) => y.msb - x.msb);
    let disjoint = true;
    for (let i = 1; i < sorted.length; i++) if (sorted[i]!.msb >= sorted[i - 1]!.lsb) disjoint = false;
    if (!disjoint) continue;
    bySignal.set(name, sorted);
    for (const sl of sorted) (byAssign.get(sl.assign) ?? byAssign.set(sl.assign, new Map()).get(sl.assign)!).set(name, sl);
  }
  return { bySignal, byAssign };
}

export function structuralToIr(file: StructuralFile, opts: ToIrOptions): SchematicDoc {
  const labelLength = opts.labelLength ?? CLOUD_LABEL;
  const diagnostics: Diagnostic[] = file.errors.slice(0, 20).map((e) => ({
    severity: "error",
    message: e.message,
    line: e.line,
    column: e.column,
    source: "structural",
  }));
  const modules: Record<string, ModuleView> = {};
  for (const m of file.modules) {
    try {
      const view = moduleToView(m, file, labelLength);
      diagnostics.push(...annotateSemantics(view, m));
      modules[m.name] = view;
    } catch (e) {
      diagnostics.push({ severity: "error", message: `structural IR failed for ${m.name}: ${String(e)}`, source: "structural", line: m.src.line });
      modules[m.name] = { name: m.name, ports: m.ports.map(portOf), nodes: [], nets: [], src: m.src };
    }
  }
  return {
    version: IR_VERSION,
    fidelity: "structural",
    top: opts.top,
    modules,
    moduleNames: file.modules.map((m) => m.name),
    diagnostics,
    sourceUri: opts.sourceUri,
    generation: opts.generation,
  };
}

function portOf(p: SModule["ports"][number]): Port {
  return { name: p.name, direction: p.direction, width: p.width, ...(p.range !== undefined ? { range: p.range } : {}), src: [p.src], ...(p.tentative ? { tentative: true } : {}) };
}

function moduleToView(m: SModule, file: StructuralFile, labelLength: number): ModuleView {
  const symbols = buildSymbols(m);
  const nets = new NetTable(symbols);
  const nodes: Node[] = [];
  const ports: Port[] = m.ports.map(portOf);

  // Signals driven by assigns/always (used for black-box pin direction inference).
  const drivenElsewhere = new Set<string>();
  for (const a of m.assigns) for (const l of a.lhs) drivenElsewhere.add(l);
  for (const a of m.always) for (const l of a.assigned) drivenElsewhere.add(l);
  for (const p of m.ports) if (p.direction === "input") drivenElsewhere.add(p.name);
  // An output nothing in this module writes is flagged, so a ports-only module explains itself (bug 21).
  // Instance connections may drive a signal, so they count here but not for pin direction inference.
  const onInstance = new Set<string>();
  for (const inst of m.instances) for (const c of inst.connections) for (const id of c.idents) onInstance.add(id);
  if (!m.hasErrors) for (const p of ports) if (p.direction !== "input" && !drivenElsewhere.has(p.name) && !onInstance.has(p.name)) p.undriven = true;

  // Ports connect to nets of the same name.
  for (const p of m.ports) {
    const end: NetEnd = { node: `port:${p.name}`, pin: p.name };
    if (p.direction === "input") nets.drive(p.name, end, p.src);
    else if (p.direction === "output") nets.sink(p.name, end, p.src);
    else nets.sink(p.name, end, p.src);
  }

  const isSignal = (id: string): boolean => symbols.has(id);

  // Several assigns that write literal, disjoint slices of one vector (assign y[5:3] = ...;
  // assign y[2:0] = ...;) each drive a slice net, and a join rebuilds the vector.
  const sliceNetOf = sliceAssignNets(m, symbols);
  for (const [name, slices] of sliceNetOf.bySignal) {
    const id = `join:${name}`;
    const width = symbols.get(name)?.width ?? 1;
    const pins: Pin[] = slices.map((sl) => {
      nets.nets.set(sl.netName, { id: `net:${sl.netName}`, name: sl.netName, width: sl.width, driver: null, sinks: [{ node: id, pin: `in:${sl.netName}` }], src: [sl.assign.src] });
      return { id: `in:${sl.netName}`, label: "", direction: "in", side: "west", width: sl.width, net: sl.netName, bits: sl.bits };
    });
    pins.push({ id: "out", label: "", direction: "out", side: "east", width, net: name });
    nets.drive(name, { node: id, pin: "out" }, symbols.get(name)?.src);
    nodes.push({ id, kind: "join", width, pins, label: "", src: slices.map((sl) => sl.assign.src) });
  }

  // Assign clouds.
  const cloudIds = new Map<string, number>();
  m.assigns.forEach((a, i) => {
    const base = `cloud:assign:${a.lhs.join(",") || i}`;
    const ordinal = cloudIds.get(base) ?? 0;
    cloudIds.set(base, ordinal + 1);
    const id = ordinal === 0 ? base : `${base}#${ordinal}`;
    const reads = a.rhs.filter(isSignal).filter((r) => !a.lhs.includes(r) || true);
    const pins: Pin[] = [];
    reads.forEach((r) => {
      pins.push({ id: `in:${r}`, label: "", direction: "in", side: "west", width: symbols.get(r)?.width ?? 1, net: r });
      nets.sink(r, { node: id, pin: `in:${r}` }, a.src);
    });
    a.lhs.forEach((l) => {
      const slice = sliceNetOf.byAssign.get(a)?.get(l);
      if (slice) {
        pins.push({ id: `out:${l}`, label: "", direction: "out", side: "east", width: slice.width, net: slice.netName });
        nets.nets.get(slice.netName)!.driver = { node: id, pin: `out:${l}` };
        return;
      }
      pins.push({ id: `out:${l}`, label: "", direction: "out", side: "east", width: symbols.get(l)?.width ?? 1, net: l });
      nets.drive(l, { node: id, pin: `out:${l}` }, a.src);
    });
    nodes.push({
      id,
      kind: "cloud",
      width: 1,
      pins,
      label: truncate(`${a.lhsText} = ${a.rhsText}`, labelLength),
      src: [a.src],
      info: { expression: `${a.lhsText} = ${a.rhsText}` },
    });
  });

  // Always clouds.
  m.always.forEach((al, i) => {
    const id = `cloud:always:${al.assigned.join(",") || i}`;
    const pins: Pin[] = [];
    const reads = al.read.filter(isSignal);
    for (const r of reads) {
      const isClock = al.clocks.includes(r);
      pins.push({ id: `in:${r}`, label: "", direction: "in", side: isClock ? "south" : "west", width: symbols.get(r)?.width ?? 1, net: r });
      nets.sink(r, { node: id, pin: `in:${r}` }, al.src);
    }
    for (const c of al.clocks) {
      if (reads.includes(c) || !isSignal(c)) continue;
      pins.push({ id: `in:${c}`, label: "", direction: "in", side: "south", width: 1, net: c });
      nets.sink(c, { node: id, pin: `in:${c}` }, al.src);
    }
    for (const l of al.assigned.filter(isSignal)) {
      pins.push({ id: `out:${l}`, label: "", direction: "out", side: "east", width: symbols.get(l)?.width ?? 1, net: l });
      nets.drive(l, { node: id, pin: `out:${l}` }, al.src);
    }
    nodes.push({
      id,
      kind: "cloud",
      width: 1,
      pins,
      label: truncate(`always ${al.sensitivity}${al.assigned.length > 0 ? `: ${al.assigned.join(", ")}` : ""}`, labelLength + 8),
      src: [al.src],
      info: { kind: al.kind === "seq" ? "sequential" : "combinational", sensitivity: al.sensitivity },
    });
  });

  // Instances.
  m.instances.forEach((inst, i) => {
    const node = instanceNode(inst, m, file, symbols, nets, i, drivenElsewhere);
    nodes.push(node);
    for (const pin of node.pins) {
      if (pin.net === null) continue;
      const end: NetEnd = { node: node.id, pin: pin.id };
      if (pin.net.startsWith("const:")) {
        const conn = inst.connections.find((c) => (c.port ?? `p${c.index}`) === pin.id);
        const cid = pin.net;
        nodes.push({ id: cid, kind: "const", width: pin.width, pins: [{ id: "Y", label: "", direction: "out", side: "east", width: pin.width, net: cid }], label: conn?.exprText.trim() ?? "const", src: conn ? [conn.src] : [] });
        nets.nets.set(cid, { id: cid, width: pin.width, driver: { node: cid, pin: "Y" }, sinks: [end], src: conn ? [conn.src] : [] });
        continue;
      }
      if (pin.net.startsWith("expr:")) {
        // An expression actual (a[15:0], {x,y}): make a cloud that reads the identifiers.
        const conn = inst.connections.find((c) => (c.port ?? `p${c.index}`) === pin.id);
        const eid = `cloud:${pin.net}`;
        const epins: Pin[] = [];
        const ids = conn?.idents.filter(isSignal) ?? [];
        if (pin.direction === "out") {
          epins.push({ id: "in", label: "", direction: "in", side: "west", width: pin.width, net: pin.net });
          for (const sid of ids) {
            epins.push({ id: `out:${sid}`, label: "", direction: "out", side: "east", width: symbols.get(sid)?.width ?? 1, net: sid });
            nets.drive(sid, { node: eid, pin: `out:${sid}` }, conn?.src);
          }
          nets.nets.set(pin.net, { id: pin.net, width: pin.width, driver: end, sinks: [{ node: eid, pin: "in" }], src: conn ? [conn.src] : [] });
        } else {
          for (const sid of ids) {
            epins.push({ id: `in:${sid}`, label: "", direction: "in", side: "west", width: symbols.get(sid)?.width ?? 1, net: sid });
            nets.sink(sid, { node: eid, pin: `in:${sid}` }, conn?.src);
          }
          epins.push({ id: "out", label: "", direction: "out", side: "east", width: pin.width, net: pin.net });
          nets.nets.set(pin.net, { id: pin.net, width: pin.width, driver: { node: eid, pin: "out" }, sinks: [end], src: conn ? [conn.src] : [] });
        }
        nodes.push({ id: eid, kind: "cloud", width: pin.width, pins: epins, label: truncate(conn?.exprText ?? "", labelLength), src: conn ? [conn.src] : [] });
        continue;
      }
      if (pin.direction === "out") nets.drive(pin.net, end);
      else nets.sink(pin.net, end);
    }
  });

  // Clocks named in sequential always blocks, resets by name.
  for (const al of m.always) for (const c of al.clocks) if (nets.nets.has(c)) nets.nets.get(c)!.role = "clock";
  for (const n of nets.nets.values()) if (!n.role && n.name && /^(a?rst|a?reset|rst_n|reset_n|nrst)$/i.test(n.name)) n.role = "reset";

  // Rename net ids used by pins to the net table ids.
  for (const n of nodes) {
    for (const p of n.pins) {
      if (p.net !== null && nets.nets.has(p.net)) p.net = nets.nets.get(p.net)!.id;
    }
  }

  return { name: m.name, ports, nodes, nets: [...nets.nets.values()], src: m.src };
}
