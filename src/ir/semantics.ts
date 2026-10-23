// Semantic checks drawn into the diagram (BUG_HUNT.md A2): a net driven by
// more than one statement, and a combinational loop. Both views get the
// badges: the structural layer finds the multiple drivers (Yosys silently
// merges them), the graph walk finds loops in whichever view is drawn.
import { parseLvalue, type LvalueTarget } from "../structural/lvalues";
import type { SModule } from "../structural/types";
import { parseRange } from "../structural/width";
import type { Diagnostic, ModuleView, Net, SrcRange } from "./types";

export const MULTIPLE_DRIVERS = "multiple drivers";
export const COMBINATIONAL_LOOP = "combinational loop";

/** Bits a statement writes: a literal range, or the whole signal when nothing narrower is known. */
type BitSet = "all" | Set<number>;

interface Driver {
  bits: BitSet;
  src: SrcRange;
}

function declaredRange(m: SModule, name: string): { msb: number; lsb: number } | undefined {
  const sym = m.ports.find((p) => p.name === name) ?? m.decls.find((d) => d.name === name);
  if (!sym) return undefined;
  const r = parseRange(sym.range);
  if (r && r.width > 0) {
    const [a, b] = r.range.slice(1, -1).split(":").map(Number);
    return a !== undefined && b !== undefined ? { msb: Math.max(a, b), lsb: Math.min(a, b) } : undefined;
  }
  return sym.width > 0 ? { msb: sym.width - 1, lsb: 0 } : undefined;
}

function bitsOf(target: LvalueTarget): BitSet {
  if (target.msb === undefined || target.lsb === undefined) return "all";
  const out = new Set<number>();
  for (let b = target.lsb; b <= target.msb; b++) out.add(b);
  return out;
}

function overlap(a: BitSet, b: BitSet, whole: { msb: number; lsb: number } | undefined): BitSet | undefined {
  if (a === "all" && b === "all") return "all";
  if (a === "all" || b === "all") {
    const set = a === "all" ? (b as Set<number>) : (a as Set<number>);
    if (!whole) return set.size > 0 ? set : undefined;
    const inside = new Set([...set].filter((x) => x >= whole.lsb && x <= whole.msb));
    return inside.size > 0 ? inside : undefined;
  }
  const both = new Set([...a].filter((x) => b.has(x)));
  return both.size > 0 ? both : undefined;
}

/** "[6:5], [0]" for the bits 6, 5 and 0. */
function formatBits(bits: Set<number>): string {
  const sorted = [...bits].sort((x, y) => y - x);
  const ranges: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! - 1) j++;
    ranges.push(sorted[i] === sorted[j] ? `[${sorted[i]}]` : `[${sorted[i]}:${sorted[j]}]`);
    i = j + 1;
  }
  return ranges.join(", ");
}

export interface MultipleDriverFinding {
  name: string;
  /** Overlapping bit ranges, e.g. "[3:2]"; absent when whole-signal writes clash */
  bits?: string;
  /** Source of every clashing statement, in order */
  srcs: SrcRange[];
}

/**
 * Signals with more than one driver on the same bit. Each assign and each always
 * block is one driver; writes to disjoint bit ranges of one vector are legal.
 */
export function multipleDriverReport(m: SModule): MultipleDriverFinding[] {
  const drivers = new Map<string, Driver[]>();
  const add = (name: string, bits: BitSet, src: SrcRange): void => {
    const list = drivers.get(name) ?? drivers.set(name, []).get(name)!;
    const same = list.find((d) => d.src === src);
    if (!same) {
      list.push({ bits, src });
      return;
    }
    // Several writes in one statement or block are one driver: merge the bits.
    if (same.bits === "all" || bits === "all") same.bits = "all";
    else for (const b of bits) same.bits.add(b);
  };
  for (const a of m.assigns) {
    const targets = parseLvalue(a.lhsText);
    const seen = new Set(targets.map((t) => t.name));
    for (const t of targets) add(t.name, bitsOf(t), a.src);
    for (const l of a.lhs) if (!seen.has(l)) add(l, "all", a.src);
  }
  for (const al of m.always) {
    const targets = (al.lhsTexts ?? []).flatMap((t) => parseLvalue(t));
    const seen = new Set(targets.map((t) => t.name));
    for (const t of targets) add(t.name, bitsOf(t), al.src);
    for (const l of al.assigned) if (!seen.has(l)) add(l, "all", al.src);
  }
  const out: MultipleDriverFinding[] = [];
  for (const [name, list] of drivers) {
    if (list.length < 2) continue;
    const whole = declaredRange(m, name);
    let clash: BitSet | undefined;
    const srcs = new Set<SrcRange>();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const o = overlap(list[i]!.bits, list[j]!.bits, whole);
        if (!o) continue;
        srcs.add(list[i]!.src);
        srcs.add(list[j]!.src);
        if (clash === undefined) clash = o === "all" ? "all" : new Set(o);
        else if (clash !== "all") {
          if (o === "all") clash = "all";
          else for (const b of o) clash.add(b);
        }
      }
    }
    if (!clash) continue;
    const coversAll = clash !== "all" && whole !== undefined && clash.size === whole.msb - whole.lsb + 1;
    out.push({ name, ...(clash === "all" || coversAll ? {} : { bits: formatBits(clash) }), srcs: [...srcs].sort((a, b) => a.line - b.line || a.column - b.column) });
  }
  return out;
}

/** Names of signals with multiple drivers on at least one bit. */
export function multiplyDrivenSignals(m: SModule): string[] {
  return multipleDriverReport(m).map((f) => f.name);
}

/** Node kinds that break a combinational path. Instances may hide flops, so they count as barriers. */
function isBarrier(kind: string, info: Record<string, string> | undefined): boolean {
  if (kind === "dff" || kind === "instance" || kind === "blackbox" || kind === "const") return true;
  if (kind === "cloud" && info?.["kind"] === "sequential") return true;
  return false;
}

/** Ids of nets that lie on a cycle of combinational nodes. */
export function combinationalLoopNets(view: ModuleView): Set<string> {
  const nodeById = new Map(view.nodes.map((n) => [n.id, n]));
  // Edges: net -> nets driven by every combinational node that reads it.
  const next = new Map<string, { net: string; via: string }[]>();
  for (const net of view.nets) next.set(net.id, []);
  for (const n of view.nodes) {
    if (isBarrier(n.kind, n.info)) continue;
    const outs = n.pins.filter((p) => p.direction === "out" && p.net).map((p) => p.net!);
    for (const p of n.pins) {
      if (p.direction !== "in" || !p.net) continue;
      const list = next.get(p.net) ?? next.set(p.net, []).get(p.net)!;
      for (const o of outs) list.push({ net: o, via: n.id });
    }
  }
  const onCycle = new Set<string>();
  const state = new Map<string, 1 | 2>(); // 1 visiting, 2 done
  const stack: string[] = [];
  const visit = (net: string): void => {
    state.set(net, 1);
    stack.push(net);
    for (const e of next.get(net) ?? []) {
      const st = state.get(e.net);
      if (st === 1) {
        for (let i = stack.lastIndexOf(e.net); i >= 0 && i < stack.length; i++) onCycle.add(stack[i]!);
      } else if (st === undefined) visit(e.net);
    }
    stack.pop();
    state.set(net, 2);
  };
  for (const net of view.nets) if (!state.has(net.id)) visit(net.id);
  void nodeById;
  return onCycle;
}

function addWarning(net: Net, w: string): void {
  if (!net.warnings) net.warnings = [w];
  else if (!net.warnings.includes(w)) net.warnings.push(w);
}

/** Marks the nets and returns diagnostics for the banner and the log. */
export function annotateSemantics(view: ModuleView, module: SModule | undefined): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (module) {
    for (const f of multipleDriverReport(module)) {
      const net = view.nets.find((n) => n.name === f.name || n.aliases?.includes(f.name));
      const where = f.bits ? `${f.name}${f.bits.includes(",") ? ` bits ${f.bits}` : f.bits}` : f.name;
      if (net) addWarning(net, f.bits ? `${MULTIPLE_DRIVERS} on ${where}` : MULTIPLE_DRIVERS);
      const src = f.srcs[1] ?? f.srcs[0] ?? module.src;
      out.push({ severity: "error", message: `${where} has multiple drivers`, line: src.line, column: src.column, source: "structural" });
    }
  }
  const loops = combinationalLoopNets(view);
  const named = [...loops].map((id) => view.nets.find((n) => n.id === id)).filter((n): n is Net => n !== undefined);
  for (const net of named) addWarning(net, COMBINATIONAL_LOOP);
  const names = named.map((n) => n.name).filter((n): n is string => n !== undefined);
  if (loops.size > 0) {
    const first = named.find((n) => n.src[0])?.src[0];
    out.push({ severity: "warning", message: `combinational loop through ${names.length > 0 ? names.join(", ") : `${loops.size} net(s)`}`, ...(first ? { line: first.line, column: first.column } : {}), source: "structural" });
  }
  return out;
}
