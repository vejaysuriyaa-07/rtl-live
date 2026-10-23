// Focus mode model (no DOM): which nets and symbols light up for a hovered element.
import type { ModuleView } from "../../src/ir/types";

/** Nets to light up for a hovered element: the wire's net, or every net on a symbol's pins. */
export function focusNets(view: ModuleView, target: { net?: string; node?: string; port?: string }): Set<string> {
  const out = new Set<string>();
  if (target.net) out.add(target.net);
  if (target.node) {
    const node = view.nodes.find((n) => n.id === target.node);
    for (const p of node?.pins ?? []) if (p.net) out.add(p.net);
  }
  if (target.port) {
    const id = `port:${target.port}`;
    for (const net of view.nets) {
      if (net.driver?.node === id || net.sinks.some((s) => s.node === id)) out.add(net.id);
    }
  }
  return out;
}

/** Ids of the symbols touching any of the nets (data-id values of nodes and ports). */
export function focusSymbols(view: ModuleView, nets: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const net of view.nets) {
    if (!nets.has(net.id)) continue;
    if (net.driver) out.add(net.driver.node);
    for (const s of net.sinks) out.add(s.node);
  }
  return out;
}
