// SchematicDoc -> structural Verilog netlist. Used by the accuracy checks to
// prove that the diagram is functionally equivalent to the source: the export
// is simulated next to the original file on the same input vectors.
//
// Every net becomes a wire, every node an assign or an always block. Anything
// the IR cannot describe exactly (logic clouds, unknown cells, cells whose
// semantics the IR dropped) throws an ExportError that names the reason, so a
// functional failure is reported as "not exportable" instead of a wrong netlist.
import type { ModuleView, Node, Pin, SchematicDoc } from "./types";

export class ExportError extends Error {
  constructor(
    message: string,
    readonly nodeId?: string,
  ) {
    super(message);
    this.name = "ExportError";
  }
}

export interface ExportOptions {
  /** Suffix appended to every module name so the export can be compiled next to the source */
  suffix?: string;
}

const SIMPLE_ID = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export function verilogId(name: string): string {
  return SIMPLE_ID.test(name) ? name : `\\${name} `;
}

function rangeDecl(width: number): string {
  return width > 1 ? `[${width - 1}:0] ` : "";
}

function parseBits(label: string): string | undefined {
  // "[7:3]" or "[2]"
  const m = /^\[(\d+)(?::(\d+))?\]$/.exec(label);
  if (!m) return undefined;
  return m[2] === undefined ? `[${m[1]}]` : `[${m[1]}:${m[2]}]`;
}

/** Reset value text from cellMap info ("async, value 0101" or "async, value 5"). */
function resetValue(info: Record<string, string> | undefined, width: number): string {
  const raw = (info?.["reset"] ?? "").replace(/^.*value\s*/, "").trim();
  if (/^[01xz]+$/i.test(raw)) return `${raw.length}'b${raw}`;
  if (/^\d+$/.test(raw)) return `${width}'d${raw}`;
  throw new ExportError(`reset value unknown (${raw || "missing"})`);
}

class ModuleWriter {
  private readonly lines: string[] = [];
  private readonly netExpr = new Map<string, string>();
  private wireCount = 0;

  constructor(
    private readonly view: ModuleView,
    private readonly suffix: string,
    private readonly definedModules: ReadonlySet<string>,
  ) {}

  private expr(netId: string | null, pinWidth: number): string {
    if (netId === null) return `${pinWidth}'bz`;
    const e = this.netExpr.get(netId);
    if (e === undefined) throw new ExportError(`net ${netId} has no expression`);
    return e;
  }

  private inputs(node: Node): Pin[] {
    return node.pins.filter((p) => p.direction === "in");
  }

  private output(node: Node): Pin {
    const out = node.pins.filter((p) => p.direction === "out");
    if (out.length !== 1) throw new ExportError(`${node.kind} ${node.id} has ${out.length} outputs`, node.id);
    return out[0]!;
  }

  private operand(p: Pin): string {
    const e = this.expr(p.net, p.width);
    return p.inverted ? `(~${e})` : e;
  }

  private assign(target: string, value: string): void {
    this.lines.push(`  assign ${target} = ${value};`);
  }

  private gate(node: Node): void {
    const ins = this.inputs(node);
    const out = this.output(node);
    const y = this.expr(out.net, out.width);
    const ops = ins.map((p) => this.operand(p));
    const op = node.op ?? "";
    if (node.info?.["logical"] !== undefined) {
      // && || ! reduce each operand to one bit.
      const sym: Record<string, string> = { and: "&&", or: "||" };
      if (op === "not") {
        if (ops.length !== 1) throw new ExportError(`logical not with ${ops.length} inputs`, node.id);
        this.assign(y, `!${ops[0]}`);
        return;
      }
      const s = sym[op];
      if (!s || ops.length < 2) throw new ExportError(`logical ${op} with ${ops.length} inputs`, node.id);
      this.assign(y, ops.join(` ${s} `));
      return;
    }
    // A 1-bit output fed by wider inputs cannot be told apart from a logical operator.
    if (out.width === 1 && ins.some((p) => p.width > 1) && op !== "not" && op !== "buf") {
      throw new ExportError(`gate ${op} with ${ins.map((p) => p.width).join("/")}-bit inputs and a 1-bit output is ambiguous (bitwise or logical)`, node.id);
    }
    const bin = (sym: string): string => ops.join(` ${sym} `);
    let rhs: string;
    switch (op) {
      case "and":
        rhs = bin("&");
        break;
      case "or":
        rhs = bin("|");
        break;
      case "xor":
        rhs = bin("^");
        break;
      case "nand":
        rhs = `~(${bin("&")})`;
        break;
      case "nor":
        rhs = `~(${bin("|")})`;
        break;
      case "xnor":
        rhs = `~(${bin("^")})`;
        break;
      case "not":
        if (ops.length !== 1) throw new ExportError(`not with ${ops.length} inputs`, node.id);
        rhs = `~${ops[0]}`;
        break;
      case "buf":
        if (ops.length !== 1) throw new ExportError(`buf with ${ops.length} inputs`, node.id);
        rhs = ops[0]!;
        break;
      default:
        throw new ExportError(`unknown gate op ${op}`, node.id);
    }
    if (ops.length === 0) throw new ExportError(`gate ${op} has no inputs`, node.id);
    this.assign(y, rhs);
  }

  private reduce(node: Node): void {
    const [a] = this.inputs(node);
    const out = this.output(node);
    if (!a) throw new ExportError("reduce without input", node.id);
    const sym: Record<string, string> = { and: "&", or: "|", xor: "^", xnor: "~^", nand: "~&", nor: "~|" };
    const s = sym[node.op ?? ""];
    if (!s) throw new ExportError(`unknown reduce op ${node.op}`, node.id);
    this.assign(this.expr(out.net, out.width), `${s}${this.operand(a)}`);
  }

  private mux(node: Node): void {
    const pins = new Map(node.pins.map((p) => [p.id, p]));
    const a = pins.get("A");
    const b = pins.get("B");
    const s = pins.get("S");
    const y = pins.get("Y");
    if (!a || !b || !s || !y) throw new ExportError("mux pins missing", node.id);
    this.assign(this.expr(y.net, y.width), `${this.operand(s)} ? ${this.operand(b)} : ${this.operand(a)}`);
  }

  private pmux(node: Node): void {
    const pins = new Map(node.pins.map((p) => [p.id, p]));
    const a = pins.get("A");
    const s = pins.get("S");
    const y = pins.get("Y");
    if (!a || !s || !y) throw new ExportError("pmux pins missing", node.id);
    if (node.label === "BMUX") throw new ExportError("bmux semantics not represented (select is an index, not one-hot)", node.id);
    const cases = node.pins.filter((p) => /^B\d+$/.test(p.id)).sort((p, q) => Number(p.id.slice(1)) - Number(q.id.slice(1)));
    if (cases.length !== s.width) throw new ExportError(`pmux has ${cases.length} cases for a ${s.width}-bit select`, node.id);
    const sel = this.operand(s);
    let rhs = this.operand(a);
    // Priority chain; equal to the one-hot semantics whenever at most one select bit is set.
    for (let i = cases.length - 1; i >= 0; i--) rhs = `${sel}[${i}] ? ${this.operand(cases[i]!)} : (${rhs})`;
    this.assign(this.expr(y.net, y.width), rhs);
  }

  private dff(node: Node): void {
    const pins = new Map(node.pins.map((p) => [p.id, p]));
    const d = pins.get("D");
    const q = pins.get("Q");
    const clk = pins.get("CLK");
    const en = pins.get("EN");
    const r = pins.get("R");
    const type = node.op ?? "";
    if (!d || !q) throw new ExportError("dff pins missing", node.id);
    const qe = this.expr(q.net, q.width);
    const de = this.operand(d);
    const reg = `r_${this.wireCount++}`;
    this.lines.push(`  reg ${rangeDecl(q.width)}${reg};`);
    this.assign(qe, reg);
    const enCond = en ? (en.inverted ? `!${this.expr(en.net, en.width)}` : this.expr(en.net, en.width)) : undefined;
    const rstCond = r ? (r.inverted ? `!${this.expr(r.net, r.width)}` : this.expr(r.net, r.width)) : undefined;
    const rstEdge = r ? (r.inverted ? `negedge ${this.expr(r.net, r.width)}` : `posedge ${this.expr(r.net, r.width)}`) : undefined;
    if (type === "dlatch" || type === "adlatch") {
      // EN is the transparent-high (or low) enable.
      if (!enCond) throw new ExportError("latch without enable", node.id);
      const body = type === "adlatch" && rstCond ? `if (${rstCond}) ${reg} = ${resetValue(node.info, q.width)}; else if (${enCond}) ${reg} = ${de};` : `if (${enCond}) ${reg} = ${de};`;
      this.lines.push(`  always @* ${body}`);
      return;
    }
    if (!clk) throw new ExportError(`${type} without clock`, node.id);
    const clkEdge = `${clk.inverted ? "negedge" : "posedge"} ${this.expr(clk.net, clk.width)}`;
    const load = enCond ? `if (${enCond}) ${reg} <= ${de};` : `${reg} <= ${de};`;
    switch (type) {
      case "dff":
      case "dffe":
        this.lines.push(`  always @(${clkEdge}) ${load}`);
        return;
      case "adff":
      case "adffe":
        if (!rstCond) throw new ExportError("adff without reset", node.id);
        this.lines.push(`  always @(${clkEdge} or ${rstEdge}) if (${rstCond}) ${reg} <= ${resetValue(node.info, q.width)}; else ${load}`);
        return;
      case "sdff":
      case "sdffe":
        if (!rstCond) throw new ExportError("sdff without reset", node.id);
        // Reset has priority over the enable.
        this.lines.push(`  always @(${clkEdge}) if (${rstCond}) ${reg} <= ${resetValue(node.info, q.width)}; else ${load}`);
        return;
      case "sdffce":
        if (!rstCond || !enCond) throw new ExportError("sdffce without reset or enable", node.id);
        // Enable gates the reset.
        this.lines.push(`  always @(${clkEdge}) if (${enCond}) begin if (${rstCond}) ${reg} <= ${resetValue(node.info, q.width)}; else ${reg} <= ${de}; end`);
        return;
      default:
        throw new ExportError(`flip-flop type ${type} not supported by the exporter`, node.id);
    }
  }

  private arith(node: Node): void {
    const ins = this.inputs(node);
    const out = this.output(node);
    const y = this.expr(out.net, out.width);
    const sym: Record<string, string> = { add: "+", sub: "-", mul: "*", div: "/", mod: "%", pow: "**" };
    if (node.op === "neg") {
      if (ins.length !== 1) throw new ExportError("neg with two inputs", node.id);
      this.assign(y, `-${this.operand(ins[0]!)}`);
      return;
    }
    const s = sym[node.op ?? ""];
    if (!s || ins.length !== 2) throw new ExportError(`unknown arith op ${node.op}`, node.id);
    if (node.info?.["signed"] !== undefined) throw new ExportError("signed arithmetic not represented", node.id);
    this.assign(y, `${this.operand(ins[0]!)} ${s} ${this.operand(ins[1]!)}`);
  }

  private compare(node: Node): void {
    const ins = this.inputs(node);
    const out = this.output(node);
    const sym: Record<string, string> = { eq: "==", ne: "!=", lt: "<", le: "<=", gt: ">", ge: ">=" };
    const s = sym[node.op ?? ""];
    if (!s || ins.length !== 2) throw new ExportError(`unknown compare op ${node.op}`, node.id);
    this.assign(this.expr(out.net, out.width), `${this.operand(ins[0]!)} ${s} ${this.operand(ins[1]!)}`);
  }

  private shift(node: Node): void {
    const ins = this.inputs(node);
    const out = this.output(node);
    if (ins.length !== 2) throw new ExportError("shift needs two inputs", node.id);
    const a = this.operand(ins[0]!);
    const b = this.operand(ins[1]!);
    const y = this.expr(out.net, out.width);
    switch (node.op) {
      case "shl":
        this.assign(y, `${a} << ${b}`);
        return;
      case "shr":
        this.assign(y, `${a} >> ${b}`);
        return;
      case "sshr":
        this.assign(y, `$signed({{${out.width}{${a}[${ins[0]!.width - 1}]}}, ${a}}) >>> ${b}`);
        return;
      default:
        throw new ExportError(`shift op ${node.op} not supported by the exporter`, node.id);
    }
  }

  private constant(node: Node): void {
    const out = this.output(node);
    const label = node.info?.["value"] ?? node.label;
    if (!/^\d+'[bhd][0-9a-fA-FxXzZ_]+$/.test(label)) throw new ExportError(`constant label ${label} is not a literal`, node.id);
    this.assign(this.expr(out.net, out.width), label);
  }

  private split(node: Node): void {
    const [inp] = this.inputs(node);
    if (!inp) throw new ExportError("split without input", node.id);
    const src = this.expr(inp.net, inp.width);
    for (const p of node.pins) {
      if (p.direction !== "out") continue;
      const bits = p.bits ? parseBits(p.bits) : undefined;
      if (!bits) throw new ExportError(`split pin ${p.id} has no bit range`, node.id);
      if (p.net === null) continue;
      this.assign(this.expr(p.net, p.width), `${src}${bits}`);
    }
  }

  private join(node: Node): void {
    const out = this.output(node);
    const target = this.expr(out.net, out.width);
    for (const p of node.pins) {
      if (p.direction !== "in") continue;
      const bits = p.bits ? parseBits(p.bits) : undefined;
      if (!bits) throw new ExportError(`join pin ${p.id} has no bit range`, node.id);
      const rep = /^x(\d+)$/.exec(p.label);
      const value = rep ? `{${rep[1]}{${this.operand(p)}}}` : this.operand(p);
      this.assign(`${target}${bits}`, value);
    }
  }

  private instance(node: Node): void {
    const type = node.moduleType;
    if (!type) throw new ExportError("instance without module type", node.id);
    const name = node.id.replace(/^inst:/, "");
    const conns = node.pins.map((p) => `.${verilogId(p.id)}(${p.net === null ? "" : this.expr(p.net, p.width)})`);
    const typeName = this.definedModules.has(type) ? `${type}${this.suffix}` : type;
    this.lines.push(`  ${verilogId(typeName)} ${verilogId(name)}(${conns.join(", ")});`);
  }

  write(): string {
    const v = this.view;
    const ports = v.ports.map((p) => {
      if (p.direction === "inout") throw new ExportError(`inout port ${p.name} not supported by the exporter`);
      if (p.width < 1) throw new ExportError(`port ${p.name} has unknown width`);
      return `${p.direction} ${rangeDecl(p.width)}${verilogId(p.name)}`;
    });
    const header = `module ${verilogId(`${v.name}${this.suffix}`)}(${ports.join(", ")});`;
    // Net expressions: input ports by name, everything else a numbered wire.
    const portByName = new Map(v.ports.map((p) => [p.name, p]));
    const decls: string[] = [];
    for (const net of v.nets) {
      const drv = net.driver;
      if (drv && drv.node.startsWith("port:") && portByName.get(drv.pin)?.direction === "input") {
        this.netExpr.set(net.id, verilogId(drv.pin));
        continue;
      }
      const w = `w_${this.wireCount++}`;
      decls.push(`  wire ${rangeDecl(net.width)}${w};`);
      this.netExpr.set(net.id, w);
    }
    this.lines.push(...decls);
    // Output ports read the net that sinks into them.
    for (const net of v.nets) {
      for (const s of net.sinks) {
        if (!s.node.startsWith("port:")) continue;
        const port = portByName.get(s.pin);
        if (!port || port.direction !== "output") continue;
        this.assign(verilogId(port.name), this.expr(net.id, net.width));
      }
    }
    for (const node of v.nodes) this.node(node);
    return `${header}\n${this.lines.join("\n")}\nendmodule\n`;
  }

  private node(node: Node): void {
    switch (node.kind) {
      case "gate":
        return this.gate(node);
      case "reduce":
        return this.reduce(node);
      case "mux":
        return this.mux(node);
      case "pmux":
        return this.pmux(node);
      case "dff":
        return this.dff(node);
      case "arith":
        return this.arith(node);
      case "compare":
        return this.compare(node);
      case "shift":
        return this.shift(node);
      case "const":
        return this.constant(node);
      case "split":
        return this.split(node);
      case "join":
        return this.join(node);
      case "instance":
      case "blackbox":
        return this.instance(node);
      case "cloud":
        throw new ExportError(`logic cloud "${node.label}" has no netlist semantics`, node.id);
      default:
        throw new ExportError(`${node.kind} node ${node.label} cannot be exported`, node.id);
    }
  }
}

/** Export every module of the document as Verilog (top last). Throws ExportError. */
export function docToVerilog(doc: SchematicDoc, opts: ExportOptions = {}): string {
  const suffix = opts.suffix ?? "";
  const defined = new Set(Object.keys(doc.modules));
  const out: string[] = [];
  for (const [name, view] of Object.entries(doc.modules)) {
    if (name === doc.top) continue;
    out.push(new ModuleWriter(view, suffix, defined).write());
  }
  const top = doc.modules[doc.top];
  if (!top) throw new ExportError(`top module ${doc.top} missing from the document`);
  out.push(new ModuleWriter(top, suffix, defined).write());
  return out.join("\n");
}
