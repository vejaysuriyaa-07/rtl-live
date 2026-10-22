// Yosys write_json -> SchematicDoc (fidelity "synthesized").
//
// Nets are rebuilt from bit ids. Every driving endpoint (module input port or
// cell output pin) defines one bus-level net. A sink whose bit vector is not
// exactly one driver's vector is decomposed into runs (slices of a driver,
// repeated bits, constants) and wired through split/join/const nodes.
// This splitter/joiner idea follows netlistsvg (MIT); the code here is original.
import { cellSpec, type PinSpec } from "./cellMap";
import { shortHash, stableNodeId } from "./stableIds";
import { parseSrc } from "./srcRange";
import { IR_VERSION, type Diagnostic, type ModuleView, type Net, type NetEnd, type Node, type Pin, type Port, type SchematicDoc, type SrcRange } from "./types";
import type { YosysBit, YosysCell, YosysDesign, YosysModule } from "../synth/yosysJson";
import { paramInt } from "../synth/yosysJson";

export interface FromYosysOptions {
  top: string;
  sourceUri: string;
  generation: number;
  /** Module names defined in the user's file (drill targets); others are black boxes */
  definedModules: ReadonlySet<string>;
  /** Names of all modules in the file, for the top dropdown */
  moduleNames: string[];
}

export interface FromYosysResult {
  doc: SchematicDoc;
  unknownCellTypes: string[];
}

interface Endpoint {
  node: string;
  pin: string;
  bits: YosysBit[];
  src: SrcRange[];
}

interface DriverNet {
  key: string;
  ep: Endpoint;
  bits: YosysBit[];
  name: string | undefined;
  id: string;
  src: SrcRange[];
  sinks: NetEnd[];
}

type Run =
  | { kind: "slice"; net: DriverNet; from: number; to: number }
  | { kind: "repeat"; net: DriverNet; idx: number; count: number }
  | { kind: "const"; value: string; width: number }
  | { kind: "undriven"; width: number };

function bitKey(b: YosysBit): string {
  return typeof b === "number" ? `n${b}` : `c${b}`;
}

function constLabel(value: string): string {
  // value is MSB-first binary string
  const w = value.length;
  if (/^[01]+$/.test(value) && w <= 8) return `${w}'b${value}`;
  if (/^[01]+$/.test(value)) return `${w}'h${parseInt(value, 2).toString(16)}`;
  return `${w}'b${value}`;
}

export function fromYosys(design: YosysDesign, opts: FromYosysOptions): FromYosysResult {
  const diagnostics: Diagnostic[] = [];
  const unknown = new Set<string>();
  const modules: Record<string, ModuleView> = {};
  for (const [name, ym] of Object.entries(design.modules)) {
    if (ym.attributes && (ym.attributes["blackbox"] !== undefined || ym.attributes["whitebox"] !== undefined)) continue;
    try {
      modules[name] = moduleView(name, ym, design, opts, unknown);
    } catch (e) {
      diagnostics.push({ severity: "error", message: `netlist conversion failed for ${name}: ${e instanceof Error ? e.message : String(e)}`, source: "synth" });
    }
  }
  const doc: SchematicDoc = {
    version: IR_VERSION,
    fidelity: "synthesized",
    top: opts.top,
    modules,
    moduleNames: opts.moduleNames,
    diagnostics,
    sourceUri: opts.sourceUri,
    generation: opts.generation,
  };
  return { doc, unknownCellTypes: [...unknown].sort() };
}

function moduleView(name: string, ym: YosysModule, design: YosysDesign, opts: FromYosysOptions, unknown: Set<string>): ModuleView {
  // ---- named signals by bit signature
  const namesBySig = new Map<string, { name: string; src: SrcRange[] }>();
  const srcBySig = new Map<string, SrcRange[]>();
  for (const [nn, info] of Object.entries(ym.netnames)) {
    const sig = info.bits.map(bitKey).join(",");
    const src = parseSrc(info.attributes?.["src"]);
    if (!srcBySig.has(sig)) srcBySig.set(sig, src);
    if (info.hide_name === 1 || nn.startsWith("$")) continue;
    const prev = namesBySig.get(sig);
    if (!prev || (ym.ports[nn] && !ym.ports[prev.name])) namesBySig.set(sig, { name: nn, src });
  }
  // Single-bit lookup: name of a 1-bit signal containing the bit at index i -> "name[i]"
  const bitName = new Map<string, string>();
  for (const [nn, info] of Object.entries(ym.netnames)) {
    if (info.hide_name === 1 || nn.startsWith("$")) continue;
    info.bits.forEach((b, i) => {
      if (typeof b !== "number") return;
      const k = bitKey(b);
      if (!bitName.has(k) || ym.ports[nn]) bitName.set(k, info.bits.length === 1 ? nn : `${nn}[${i}]`);
    });
  }

  // ---- endpoints
  const ports: Port[] = [];
  const driverEps: Endpoint[] = [];
  const sinkEps: Endpoint[] = [];
  for (const [pn, p] of Object.entries(ym.ports)) {
    const src = parseSrc(ym.netnames[pn]?.attributes?.["src"]);
    ports.push({ name: pn, direction: p.direction, width: p.bits.length, ...(p.bits.length > 1 ? { range: `[${p.bits.length - 1}:0]` } : {}), src });
    const ep: Endpoint = { node: `port:${pn}`, pin: pn, bits: p.bits, src };
    if (p.direction === "input") driverEps.push(ep);
    else if (p.direction === "output") sinkEps.push(ep);
    else {
      driverEps.push(ep);
      sinkEps.push(ep);
    }
  }

  interface CellInfo {
    cellName: string;
    cell: YosysCell;
    kind: Node["kind"];
    op: string | undefined;
    label: string;
    pins: { spec: PinSpec; bits: YosysBit[] }[];
    src: SrcRange[];
    warnings: string[];
    info: Record<string, string>;
    moduleType?: string;
    drillTarget?: string;
    id: string;
  }
  const cells: CellInfo[] = [];
  for (const [cn, cell] of Object.entries(ym.cells)) {
    if (cell.type === "$scopeinfo") continue;
    const src = parseSrc(cell.attributes?.["src"]);
    if (!cell.type.startsWith("$")) {
      // Instance of a user module or black box.
      const defined = opts.definedModules.has(cell.type);
      const target = design.modules[cell.type];
      const pins: { spec: PinSpec; bits: YosysBit[] }[] = [];
      for (const [conn, bits] of Object.entries(cell.connections)) {
        const dir = cell.port_directions?.[conn] ?? target?.ports[conn]?.direction ?? "input";
        const d: "in" | "out" = dir === "output" ? "out" : "in";
        pins.push({ spec: { conn, id: conn, label: conn, direction: d, side: d === "out" ? "east" : "west" }, bits });
      }
      const inst: CellInfo = {
        cellName: cn,
        cell,
        kind: defined ? "instance" : "blackbox",
        op: undefined,
        label: `${cn.replace(/^\\/, "")} : ${cell.type}`,
        pins,
        src,
        warnings: [],
        info: {},
        moduleType: cell.type,
        id: `inst:${cn.replace(/^\\/, "")}`,
      };
      if (defined) inst.drillTarget = cell.type;
      cells.push(inst);
      continue;
    }
    const spec = cellSpec(cell);
    if (spec.kind === "unknown") unknown.add(cell.type);
    let pins: { spec: PinSpec; bits: YosysBit[] }[];
    if (spec.kind === "pmux") {
      const width = paramInt(cell.parameters?.["WIDTH"], 1);
      const sWidth = paramInt(cell.parameters?.["S_WIDTH"], 1);
      const b = cell.connections["B"] ?? [];
      pins = [{ spec: { conn: "A", id: "A", label: "else", direction: "in", side: "west" }, bits: cell.connections["A"] ?? [] }];
      for (let i = 0; i < sWidth; i++) {
        pins.push({ spec: { conn: "B", id: `B${i}`, label: `${i}`, direction: "in", side: "west" }, bits: b.slice(i * width, (i + 1) * width) });
      }
      pins.push({ spec: { conn: "S", id: "S", label: "", direction: "in", side: "south" }, bits: cell.connections["S"] ?? [] });
      pins.push({ spec: { conn: "Y", id: "Y", label: "", direction: "out", side: "east" }, bits: cell.connections["Y"] ?? [] });
    } else {
      pins = spec.pins.filter((p) => cell.connections[p.conn] !== undefined).map((p) => ({ spec: p, bits: cell.connections[p.conn] ?? [] }));
    }
    cells.push({
      cellName: cn,
      cell,
      kind: spec.kind,
      op: spec.op,
      label: spec.label,
      pins,
      src,
      warnings: spec.warnings ?? [],
      info: spec.info ?? {},
      id: "",
    });
  }

  // ---- driver nets
  const driverNets = new Map<string, DriverNet>();
  const bitDriver = new Map<string, { net: DriverNet; idx: number }>();
  const addDriver = (ep: Endpoint): void => {
    const key = `${ep.node}.${ep.pin}`;
    const sig = ep.bits.map(bitKey).join(",");
    const named = namesBySig.get(sig);
    const net: DriverNet = {
      key,
      ep,
      bits: ep.bits,
      name: named?.name,
      id: "",
      src: named?.src ?? srcBySig.get(sig) ?? ep.src,
      sinks: [],
    };
    driverNets.set(key, net);
    ep.bits.forEach((b, i) => {
      if (typeof b !== "number") return;
      const k = bitKey(b);
      if (!bitDriver.has(k)) bitDriver.set(k, { net, idx: i });
    });
  };
  for (const ep of driverEps) addDriver(ep);
  // Cell output pins are drivers; their node ids are not known yet, so use a placeholder keyed by cell name.
  for (const c of cells) {
    for (const p of c.pins) {
      if (p.spec.direction === "out") addDriver({ node: `cell:${c.cellName}`, pin: p.spec.id, bits: p.bits, src: c.src });
    }
  }

  // ---- runs for a sink bit vector
  const runsOf = (bits: YosysBit[]): Run[] => {
    const runs: Run[] = [];
    for (const b of bits) {
      const last = runs[runs.length - 1];
      if (typeof b !== "number") {
        if (last && last.kind === "const") {
          last.value = b + last.value;
          last.width++;
        } else runs.push({ kind: "const", value: String(b), width: 1 });
        continue;
      }
      const d = bitDriver.get(bitKey(b));
      if (!d) {
        if (last && last.kind === "undriven") last.width++;
        else runs.push({ kind: "undriven", width: 1 });
        continue;
      }
      if (last && last.kind === "slice" && last.net === d.net && d.idx === last.to + 1) {
        last.to = d.idx;
        continue;
      }
      if (last && last.kind === "slice" && last.net === d.net && d.idx === last.to && last.from === last.to) {
        runs[runs.length - 1] = { kind: "repeat", net: d.net, idx: d.idx, count: 2 };
        continue;
      }
      if (last && last.kind === "repeat" && last.net === d.net && d.idx === last.idx) {
        last.count++;
        continue;
      }
      runs.push({ kind: "slice", net: d.net, from: d.idx, to: d.idx });
    }
    return runs;
  };

  // Name used in node ids for a run (named nets only).
  const runNames = (runs: Run[]): string[] => {
    const out: string[] = [];
    for (const r of runs) {
      if (r.kind === "slice") {
        if (r.net.name) out.push(r.from === 0 && r.to === r.net.bits.length - 1 ? r.net.name : `${r.net.name}[${r.to}:${r.from}]`);
      } else if (r.kind === "repeat") {
        if (r.net.name) out.push(`${r.net.name}[${r.idx}]x${r.count}`);
      } else if (r.kind === "const") out.push(`'${r.value}`);
    }
    return out;
  };

  // ---- node ids for cells: hash of kind, op, named nets on pins, ordinal
  const keyCount = new Map<string, number>();
  const srcOrder = (c: CellInfo): string => {
    const s = c.src[0];
    return `${String(s?.line ?? 0).padStart(6, "0")}:${String(s?.column ?? 0).padStart(5, "0")}:${c.cellName}`;
  };
  const sortedCells = [...cells].sort((a, b) => (srcOrder(a) < srcOrder(b) ? -1 : 1));
  for (const c of sortedCells) {
    if (c.id !== "") continue; // instances keep their user name
    const names: string[] = [];
    for (const p of c.pins) {
      if (p.spec.direction === "out") {
        const dn = driverNets.get(`cell:${c.cellName}.${p.spec.id}`);
        if (dn?.name) names.push(dn.name);
      } else {
        names.push(...runNames(runsOf(p.bits)));
      }
    }
    const key = `${c.kind}|${c.op ?? ""}|${[...names].sort().join(",")}`;
    const ordinal = keyCount.get(key) ?? 0;
    keyCount.set(key, ordinal + 1);
    c.id = stableNodeId(c.kind, c.op, names, ordinal);
  }
  // Rewrite driver endpoints with the final node ids.
  for (const net of driverNets.values()) {
    if (net.ep.node.startsWith("cell:")) {
      const c = cells.find((x) => `cell:${x.cellName}` === net.ep.node)!;
      net.ep = { ...net.ep, node: c.id };
    }
    net.id = net.name ? `net:${net.name}` : `net:${net.ep.node}.${net.ep.pin}`;
  }

  // ---- nodes and nets
  const nodes = new Map<string, Node>();
  const nets = new Map<string, Net>();
  const ensureNet = (dn: DriverNet): Net => {
    let n = nets.get(dn.id);
    if (!n) {
      n = { id: dn.id, ...(dn.name !== undefined ? { name: dn.name } : {}), width: dn.bits.length, driver: { node: dn.ep.node, pin: dn.ep.pin }, sinks: [], src: dn.src };
      nets.set(dn.id, n);
    }
    return n;
  };
  for (const dn of driverNets.values()) ensureNet(dn);

  const splitNodes = new Map<string, Node>(); // by driver net id
  const sliceNet = (r: Extract<Run, { kind: "slice" | "repeat" }>): Net => {
    const from = r.kind === "slice" ? r.from : r.idx;
    const to = r.kind === "slice" ? r.to : r.idx;
    const label = from === to ? `[${from}]` : `[${to}:${from}]`;
    const baseName = r.net.name ?? r.net.id.replace(/^net:/, "");
    const netId = `${r.net.id}${label}`;
    let n = nets.get(netId);
    if (n) return n;
    let split = splitNodes.get(r.net.id);
    if (!split) {
      split = { id: `split:${r.net.id}`, kind: "split", width: r.net.bits.length, pins: [{ id: "in", label: "", direction: "in", side: "west", width: r.net.bits.length, net: r.net.id }], label: "", src: r.net.src };
      splitNodes.set(r.net.id, split);
      nodes.set(split.id, split);
      ensureNet(r.net).sinks.push({ node: split.id, pin: "in" });
    }
    const pinId = `out${label}`;
    split.pins.push({ id: pinId, label: "", direction: "out", side: "east", width: to - from + 1, net: netId, bits: label });
    n = { id: netId, name: `${baseName}${label}`, width: to - from + 1, driver: { node: split.id, pin: pinId }, sinks: [], src: r.net.src };
    nets.set(netId, n);
    return n;
  };

  const constCount = new Map<string, number>();
  const constNet = (r: Extract<Run, { kind: "const" }>, sinkName: string, src: SrcRange[], portName?: string): Net => {
    const label = constLabel(r.value);
    const key = `${label}|${sinkName}`;
    const ordinal = constCount.get(key) ?? 0;
    constCount.set(key, ordinal + 1);
    const id = stableNodeId("const", label, [sinkName], ordinal);
    const netId = portName !== undefined && !nets.has(`net:${portName}`) ? `net:${portName}` : `net:${id}.Y`;
    const node: Node = { id, kind: "const", width: r.width, pins: [{ id: "Y", label: "", direction: "out", side: "east", width: r.width, net: netId }], label, src, info: { value: label } };
    nodes.set(id, node);
    const n: Net = { id: netId, ...(portName !== undefined && netId === `net:${portName}` ? { name: portName } : {}), width: r.width, driver: { node: id, pin: "Y" }, sinks: [], src };
    nets.set(netId, n);
    return n;
  };

  const joinCount = new Map<string, number>();
  const joinNodes = new Map<string, { node: Node; outNet: Net }>();
  const connectSink = (ep: NetEnd, bits: YosysBit[], src: SrcRange[], sinkName: string): string | null => {
    const portName = ep.node.startsWith("port:") ? ep.pin : undefined;
    const runs = runsOf(bits);
    if (runs.length === 0) return null;
    if (runs.length === 1) {
      const r = runs[0]!;
      if (r.kind === "undriven") return null;
      let n: Net;
      if (r.kind === "slice" && r.from === 0 && r.to === r.net.bits.length - 1) n = ensureNet(r.net);
      else if (r.kind === "slice") n = sliceNet(r);
      else if (r.kind === "repeat") {
        // A whole vector of one repeated bit: join with a single repeat input.
        n = joinFor(runs, src, sinkName, portName);
      } else n = constNet(r, sinkName, src, portName);
      n.sinks.push(ep);
      return n.id;
    }
    const n = joinFor(runs, src, sinkName, portName);
    n.sinks.push(ep);
    return n.id;
  };

  function joinFor(runs: Run[], src: SrcRange[], sinkName: string, portName?: string): Net {
    const compKey = runs
      .map((r) => (r.kind === "slice" ? `${r.net.id}[${r.to}:${r.from}]` : r.kind === "repeat" ? `${r.net.id}[${r.idx}]x${r.count}` : r.kind === "const" ? `'${r.value}` : `?${r.width}`))
      .join("|");
    const existing = joinNodes.get(compKey);
    if (existing) return existing.outNet;
    const ordinal = joinCount.get(compKey) ?? 0;
    joinCount.set(compKey, ordinal + 1);
    const id = stableNodeId("join", undefined, [...runNames(runs), sinkName], ordinal);
    const width = runs.reduce((a, r) => a + (r.kind === "slice" ? r.to - r.from + 1 : r.kind === "repeat" ? r.count : r.width), 0);
    const outNetId = portName !== undefined && !nets.has(`net:${portName}`) ? `net:${portName}` : `net:${id}.out`;
    const pins: Pin[] = [];
    let lo = 0;
    runs.forEach((r, i) => {
      const w = r.kind === "slice" ? r.to - r.from + 1 : r.kind === "repeat" ? r.count : r.width;
      const hi = lo + w - 1;
      const bitsLabel = hi === lo ? `[${lo}]` : `[${hi}:${lo}]`;
      const pinId = `in${i}`;
      let netId: string | null = null;
      if (r.kind === "slice") {
        const n = r.from === 0 && r.to === r.net.bits.length - 1 ? ensureNet(r.net) : sliceNet(r);
        n.sinks.push({ node: id, pin: pinId });
        netId = n.id;
      } else if (r.kind === "repeat") {
        const n = sliceNet(r);
        n.sinks.push({ node: id, pin: pinId });
        netId = n.id;
      } else if (r.kind === "const") {
        const n = constNet(r, sinkName, src);
        n.sinks.push({ node: id, pin: pinId });
        netId = n.id;
      }
      pins.push({ id: pinId, label: r.kind === "repeat" ? `x${r.count}` : "", direction: "in", side: "west", width: r.kind === "repeat" ? 1 : w, net: netId, bits: bitsLabel });
      lo = hi + 1;
    });
    // Join pins are listed LSB first; draw MSB at the top.
    pins.reverse();
    pins.push({ id: "out", label: "", direction: "out", side: "east", width, net: outNetId });
    const node: Node = { id, kind: "join", width, pins, label: "", src };
    nodes.set(id, node);
    const outNet: Net = { id: outNetId, ...(portName !== undefined && outNetId === `net:${portName}` ? { name: portName } : {}), width, driver: { node: id, pin: "out" }, sinks: [], src };
    nets.set(outNetId, outNet);
    joinNodes.set(compKey, { node, outNet });
    return outNet;
  }

  // Cells -> nodes
  for (const c of cells) {
    const pins: Pin[] = [];
    for (const p of c.pins) {
      const width = p.bits.length;
      if (p.spec.direction === "out") {
        const dn = driverNets.get(`${c.id}.${p.spec.id}`) ?? [...driverNets.values()].find((d) => d.ep.node === c.id && d.ep.pin === p.spec.id);
        pins.push({ id: p.spec.id, label: p.spec.label, direction: "out", side: p.spec.side, width, net: dn ? dn.id : null, ...(p.spec.inverted ? { inverted: true } : {}) });
      } else {
        const sinkName = c.kind === "instance" || c.kind === "blackbox" ? `${c.cellName}.${p.spec.id}` : c.id;
        const netId = connectSink({ node: c.id, pin: p.spec.id }, p.bits, c.src, sinkName);
        pins.push({ id: p.spec.id, label: p.spec.label, direction: "in", side: p.spec.side, width, net: netId, ...(p.spec.inverted ? { inverted: true } : {}) });
      }
    }
    const node: Node = { id: c.id, kind: c.kind, width: widthOfCell(c), pins, label: c.label, src: c.src };
    if (c.op !== undefined) node.op = c.op;
    if (c.moduleType !== undefined) node.moduleType = c.moduleType;
    if (c.drillTarget !== undefined) node.drillTarget = c.drillTarget;
    if (Object.keys(c.info).length > 0) node.info = c.info;
    if (c.warnings.length > 0) node.warnings = c.warnings;
    nodes.set(node.id, node);
  }
  // Output ports are sinks.
  for (const ep of sinkEps) {
    connectSink({ node: ep.node, pin: ep.pin }, ep.bits, ep.src, ep.pin);
  }
  // Driver nets must be registered as nets even if unused; drop nets with no sinks and no named driver? keep named.
  const netList = [...nets.values()].filter((n) => n.sinks.length > 0 || n.name !== undefined);
  // Fix driver nets' driver references for cell outputs (ids rewritten above).
  const src = parseSrc(ym.attributes?.["src"]);
  return { name, ports, nodes: [...nodes.values()], nets: netList, ...(src[0] ? { src: src[0] } : {}) };
}

function widthOfCell(c: { kind: Node["kind"]; cell: YosysCell; pins: { spec: PinSpec; bits: YosysBit[] }[] }): number {
  const y = c.pins.find((p) => p.spec.direction === "out");
  if (y) return y.bits.length;
  return paramInt(c.cell.parameters?.["WIDTH"], 1);
}

export { shortHash };
