// A synthetic 100-gate module for render and layout timing.
import type { ModuleView, Node, Pin } from "../../src/ir/types";

function pin(id: string, direction: "in" | "out", side: Pin["side"], net: string | null): Pin {
  return { id, label: "", direction, side, width: 1, net };
}

/** 100 two-input gates in a chain of fan-outs: every gate feeds the next two. */
export function bigView(gates = 100): ModuleView {
  const nodes: Node[] = [];
  const nets: ModuleView["nets"] = [];
  const ports: ModuleView["ports"] = [
    { name: "a", direction: "input", width: 1, src: [] },
    { name: "b", direction: "input", width: 1, src: [] },
    { name: "y", direction: "output", width: 1, src: [] },
  ];
  nets.push({ id: "net:a", name: "a", width: 1, driver: { node: "port:a", pin: "a" }, sinks: [], src: [] });
  nets.push({ id: "net:b", name: "b", width: 1, driver: { node: "port:b", pin: "b" }, sinks: [], src: [] });
  for (let i = 0; i < gates; i++) {
    const inA = i === 0 ? "net:a" : `net:g${Math.floor((i - 1) / 2)}`;
    const inB = i === 0 ? "net:b" : i % 3 === 0 ? "net:a" : "net:b";
    const out = `net:g${i}`;
    nodes.push({ id: `g${i}`, kind: "gate", op: i % 2 ? "and" : "or", width: 1, label: "", src: [], pins: [pin("A", "in", "west", inA), pin("B", "in", "west", inB), pin("Y", "out", "east", out)] });
    nets.push({ id: out, name: `g${i}`, width: 1, driver: { node: `g${i}`, pin: "Y" }, sinks: [], src: [] });
    nets.find((n) => n.id === inA)!.sinks.push({ node: `g${i}`, pin: "A" });
    nets.find((n) => n.id === inB)!.sinks.push({ node: `g${i}`, pin: "B" });
  }
  nets[nets.length - 1]!.sinks.push({ node: "port:y", pin: "y" });
  return { name: "big", ports, nodes, nets };
}
