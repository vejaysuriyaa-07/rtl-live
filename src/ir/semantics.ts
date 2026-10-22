// Semantic checks drawn into the diagram (BUG_HUNT.md A2): a net driven by
// more than one statement, and a combinational loop. Both views get the
// badges: the structural layer finds the multiple drivers (Yosys silently
// merges them), the graph walk finds loops in whichever view is drawn.
import type { SModule } from "../structural/types";
import type { Diagnostic, ModuleView, Net } from "./types";

export const MULTIPLE_DRIVERS = "multiple drivers";
export const COMBINATIONAL_LOOP = "combinational loop";

/** Signals assigned by more than one assign or always block. */
export function multiplyDrivenSignals(m: SModule): string[] {
  const count = new Map<string, number>();
  const bump = (name: string): void => {
    count.set(name, (count.get(name) ?? 0) + 1);
  };
  for (const a of m.assigns) for (const l of new Set(a.lhs)) bump(l);
  for (const al of m.always) for (const l of new Set(al.assigned)) bump(l);
  return [...count.entries()].filter(([, n]) => n > 1).map(([name]) => name);
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
    for (const name of multiplyDrivenSignals(module)) {
      const net = view.nets.find((n) => n.name === name || n.aliases?.includes(name));
      if (net) addWarning(net, MULTIPLE_DRIVERS);
      const src = module.assigns.filter((a) => a.lhs.includes(name)).map((a) => a.src)[1] ?? module.src;
      out.push({ severity: "error", message: `${name} has multiple drivers`, line: src.line, column: src.column, source: "structural" });
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
