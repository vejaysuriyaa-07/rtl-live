import { describe, expect, it } from "vitest";
import { bubbles, dropBuffers, mergeChains } from "../../src/ir/simplify";
import type { ModuleView, Net, Node, Pin } from "../../src/ir/types";

function gate(id: string, op: string, ins: (string | null)[], out: string | null, inverted: number[] = []): Node {
  const pins: Pin[] = ins.map((n, i) => ({ id: i === 0 ? "A" : i === 1 ? "B" : `I${i}`, label: "", direction: "in" as const, side: "west" as const, width: 1, net: n, ...(inverted.includes(i) ? { inverted: true } : {}) }));
  pins.push({ id: "Y", label: "", direction: "out", side: "east", width: 1, net: out });
  return { id, kind: "gate", op, width: 1, pins, label: op.toUpperCase(), src: [{ line: 1, column: 1, endLine: 1, endColumn: 2 }] };
}

function net(id: string, driver: [string, string], sinks: [string, string][], name?: string): Net {
  return { id, ...(name ? { name } : {}), width: 1, driver: { node: driver[0], pin: driver[1] }, sinks: sinks.map(([node, pin]) => ({ node, pin })), src: [] };
}

function view(nodes: Node[], nets: Net[]): ModuleView {
  return { name: "m", ports: [], nodes, nets };
}

describe("simplify rules", () => {
  it("mergeChains folds a & b & c into one 3-input AND", () => {
    const v = view(
      [gate("g1", "and", ["net:a", "net:b"], "net:t"), gate("g2", "and", ["net:t", "net:c"], "net:y")],
      [net("net:a", ["port:a", "a"], [["g1", "A"]], "a"), net("net:b", ["port:b", "b"], [["g1", "B"]], "b"), net("net:t", ["g1", "Y"], [["g2", "A"]]), net("net:c", ["port:c", "c"], [["g2", "B"]], "c"), net("net:y", ["g2", "Y"], [["port:y", "y"]], "y")],
    );
    const r = mergeChains(v);
    expect(r.nodes.map((n) => n.id)).toEqual(["g2"]);
    const g = r.nodes[0]!;
    expect(g.pins.filter((p) => p.direction === "in").map((p) => p.net)).toEqual(["net:a", "net:b", "net:c"]);
    expect(r.nets.find((n) => n.id === "net:t")).toBeUndefined();
    expect(r.nets.find((n) => n.id === "net:a")!.sinks).toEqual([{ node: "g2", pin: "I0" }]);
  });

  it("mergeChains keeps a user-named intermediate net", () => {
    const v = view(
      [gate("g1", "and", ["net:a", "net:b"], "net:t"), gate("g2", "and", ["net:t", "net:c"], "net:y")],
      [net("net:a", ["port:a", "a"], [["g1", "A"]], "a"), net("net:b", ["port:b", "b"], [["g1", "B"]], "b"), net("net:t", ["g1", "Y"], [["g2", "A"]], "t"), net("net:c", ["port:c", "c"], [["g2", "B"]], "c"), net("net:y", ["g2", "Y"], [["port:y", "y"]], "y")],
    );
    expect(mergeChains(v).nodes.length).toBe(2);
  });

  it("mergeChains does not mix different ops or fan-out nets", () => {
    const v = view(
      [gate("g1", "and", ["net:a", "net:b"], "net:t"), gate("g2", "or", ["net:t", "net:c"], "net:y")],
      [net("net:t", ["g1", "Y"], [["g2", "A"]]), net("net:a", ["port:a", "a"], [["g1", "A"]], "a"), net("net:b", ["port:b", "b"], [["g1", "B"]], "b"), net("net:c", ["port:c", "c"], [["g2", "B"]], "c"), net("net:y", ["g2", "Y"], [], "y")],
    );
    expect(mergeChains(v).nodes.length).toBe(2);
  });

  it("dropBuffers connects through", () => {
    const v = view(
      [gate("b1", "buf", ["net:a"], "net:t"), gate("g2", "and", ["net:t", "net:c"], "net:y")],
      [net("net:a", ["port:a", "a"], [["b1", "A"]], "a"), net("net:t", ["b1", "Y"], [["g2", "A"]]), net("net:c", ["port:c", "c"], [["g2", "B"]], "c"), net("net:y", ["g2", "Y"], [], "y")],
    );
    const r = dropBuffers(v);
    expect(r.nodes.map((n) => n.id)).toEqual(["g2"]);
    expect(r.nodes[0]!.pins[0]!.net).toBe("net:a");
    expect(r.nets.find((n) => n.id === "net:a")!.sinks).toEqual([{ node: "g2", pin: "A" }]);
  });

  it("bubbles: NOT into a single gate input becomes an inverted pin", () => {
    const v = view(
      [gate("n1", "not", ["net:a"], "net:t"), gate("g2", "and", ["net:t", "net:c"], "net:y")],
      [net("net:a", ["port:a", "a"], [["n1", "A"]], "a"), net("net:t", ["n1", "Y"], [["g2", "A"]]), net("net:c", ["port:c", "c"], [["g2", "B"]], "c"), net("net:y", ["g2", "Y"], [], "y")],
    );
    const r = bubbles(v);
    expect(r.nodes.map((n) => n.id)).toEqual(["g2"]);
    const a = r.nodes[0]!.pins.find((p) => p.id === "A")!;
    expect(a.inverted).toBe(true);
    expect(a.net).toBe("net:a");
  });

  it("bubbles: gate feeding only a NOT becomes nand/nor/xnor", () => {
    const v = view(
      [gate("g1", "xor", ["net:a", "net:b"], "net:t"), gate("n1", "not", ["net:t"], "net:y")],
      [net("net:a", ["port:a", "a"], [["g1", "A"]], "a"), net("net:b", ["port:b", "b"], [["g1", "B"]], "b"), net("net:t", ["g1", "Y"], [["n1", "A"]]), net("net:y", ["n1", "Y"], [["port:y", "y"]], "y")],
    );
    const r = bubbles(v);
    expect(r.nodes.map((n) => n.op)).toEqual(["xnor"]);
    expect(r.nets.find((n) => n.id === "net:y")!.driver).toEqual({ node: "g1", pin: "Y" });
    expect(r.nodes[0]!.pins.find((p) => p.id === "Y")!.net).toBe("net:y");
  });

  it("bubbles: NOT driving a port stays", () => {
    const v = view([gate("n1", "not", ["net:a"], "net:y")], [net("net:a", ["port:a", "a"], [["n1", "A"]], "a"), net("net:y", ["n1", "Y"], [["port:y", "y"]], "y")]);
    expect(bubbles(v).nodes.length).toBe(1);
  });
});
