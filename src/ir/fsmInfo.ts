// Annotates flip-flops that hold an FSM state with the module's localparam names,
// so the tooltip can list them (fsm_moore: "A = 1'b0, B = 1'b1").
import type { SModule } from "../structural/types";
import type { ModuleView } from "./types";

export function annotateStateRegisters(view: ModuleView, module: SModule | undefined): ModuleView {
  if (!module || module.localparams.length === 0) return view;
  const paramNames = new Set(module.localparams.map((p) => p.name));
  const states = module.localparams.map((p) => `${p.name} = ${p.valueText}`).join(", ");
  const netById = new Map(view.nets.map((n) => [n.id, n] as const));
  // Registers touched together with localparam names in an always block.
  const stateRegs = new Set<string>();
  for (const al of module.always) {
    const usesParams = al.read.some((r) => paramNames.has(r));
    if (!usesParams) continue;
    for (const a of al.assigned) stateRegs.add(a);
    for (const r of al.read) if (!paramNames.has(r)) stateRegs.add(r);
  }
  if (stateRegs.size === 0) return view;
  const nodes = view.nodes.map((n) => {
    if (n.kind !== "dff") return n;
    const q = n.pins.find((p) => p.id === "Q");
    const net = q?.net ? netById.get(q.net) : undefined;
    const names = net ? [net.name, ...(net.aliases ?? [])].filter((x): x is string => x !== undefined) : [];
    if (!names.some((nm) => stateRegs.has(nm))) return n;
    return { ...n, info: { ...(n.info ?? {}), states } };
  });
  return { ...view, nodes };
}
