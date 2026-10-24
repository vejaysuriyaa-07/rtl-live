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

  it("logical operators never merge with or bubble into bitwise gates", () => {
    const logical = (n: Node): Node => ({ ...n, info: { logical: "1" } });
    // !a feeding a bitwise AND stays a separate NOT.
    const v1 = view(
      [logical(gate("n1", "not", ["net:a"], "net:t")), gate("g1", "and", ["net:t", "net:b"], "net:y")],
      [net("net:a", ["port:a", "a"], [["n1", "A"]], "a"), net("net:t", ["n1", "Y"], [["g1", "A"]]), net("net:b", ["port:b", "b"], [["g1", "B"]], "b"), net("net:y", ["g1", "Y"], [["port:y", "y"]], "y")],
    );
    expect(bubbles(v1).nodes.map((n) => n.id).sort()).toEqual(["g1", "n1"]);
    // (a && b) feeding a bitwise NOT keeps both nodes.
    const v2 = view(
      [logical(gate("g1", "and", ["net:a", "net:b"], "net:t")), gate("n1", "not", ["net:t"], "net:y")],
      [net("net:a", ["port:a", "a"], [["g1", "A"]], "a"), net("net:b", ["port:b", "b"], [["g1", "B"]], "b"), net("net:t", ["g1", "Y"], [["n1", "A"]]), net("net:y", ["n1", "Y"], [["port:y", "y"]], "y")],
    );
    expect(bubbles(v2).nodes.map((n) => n.id).sort()).toEqual(["g1", "n1"]);
    // (a && b) & c does not fold into one gate; a && b && c does.
    const v3 = view(
      [logical(gate("g1", "and", ["net:a", "net:b"], "net:t")), gate("g2", "and", ["net:t", "net:c"], "net:y")],
      [net("net:a", ["port:a", "a"], [["g1", "A"]], "a"), net("net:b", ["port:b", "b"], [["g1", "B"]], "b"), net("net:t", ["g1", "Y"], [["g2", "A"]]), net("net:c", ["port:c", "c"], [["g2", "B"]], "c"), net("net:y", ["g2", "Y"], [["port:y", "y"]], "y")],
    );
    expect(mergeChains(v3).nodes).toHaveLength(2);
    const v4 = view([logical(v3.nodes[0]!), logical(v3.nodes[1]!)], v3.nets);
    expect(mergeChains(v4).nodes).toHaveLength(1);
  });
});

// Mutation run (2026-10-23): the naming rules of dropBuffers survived every flip.
describe("dropBuffers naming rules", () => {
  it("keeps a buffer between two named nets (a user-visible rename)", () => {
    const v = view(
      [gate("b1", "buf", ["net:a"], "net:t"), gate("g2", "and", ["net:t", "net:c"], "net:y")],
      [net("net:a", ["port:a", "a"], [["b1", "A"]], "a"), net("net:t", ["b1", "Y"], [["g2", "A"]], "t"), net("net:c", ["port:c", "c"], [["g2", "B"]], "c"), net("net:y", ["g2", "Y"], [], "y")],
    );
    const r = dropBuffers(v);
    expect(r.nodes.map((n) => n.id)).toEqual(["b1", "g2"]);
    expect(r.nets.map((n) => n.id)).toContain("net:t");
  });

  it("an unnamed input net takes the dropped output net's name; a named one keeps its own", () => {
    const v = view(
      [gate("g0", "or", ["net:p", "net:q"], "net:u"), gate("b1", "buf", ["net:u"], "net:t"), gate("g2", "and", ["net:t", "net:c"], "net:y")],
      [net("net:p", ["port:p", "p"], [["g0", "A"]], "p"), net("net:q", ["port:q", "q"], [["g0", "B"]], "q"), net("net:u", ["g0", "Y"], [["b1", "A"]]), net("net:t", ["b1", "Y"], [["g2", "A"], ["port:t", "t"]], "t"), net("net:c", ["port:c", "c"], [["g2", "B"]], "c"), net("net:y", ["g2", "Y"], [], "y")],
    );
    const r = dropBuffers(v);
    expect(r.nodes.map((n) => n.id)).toEqual(["g0", "g2"]);
    const u = r.nets.find((n) => n.id === "net:u")!;
    expect(u.name).toBe("t");
    expect(u.sinks).toEqual([{ node: "g2", pin: "A" }, { node: "port:t", pin: "t" }]);
    expect(r.nodes.find((n) => n.id === "g2")!.pins[0]!.net).toBe("net:u");
    const w = view(
      [gate("b1", "buf", ["net:a"], "net:t"), gate("g2", "and", ["net:t", "net:c"], "net:y")],
      [net("net:a", ["port:a", "a"], [["b1", "A"]], "a"), net("net:t", ["b1", "Y"], [["g2", "A"]]), net("net:c", ["port:c", "c"], [["g2", "B"]], "c"), net("net:y", ["g2", "Y"], [], "y")],
    );
    expect(dropBuffers(w).nets.find((n) => n.id === "net:a")!.name).toBe("a");
  });

  it("a buffer with no output net or no input net is left alone", () => {
    const v = view([gate("b1", "buf", ["net:a"], null)], [net("net:a", ["port:a", "a"], [["b1", "A"]], "a")]);
    expect(dropBuffers(v).nodes.map((n) => n.id)).toEqual(["b1"]);
    const w = view([gate("b1", "buf", [null], "net:t")], [net("net:t", ["b1", "Y"], [], "t")]);
    expect(dropBuffers(w).nodes.map((n) => n.id)).toEqual(["b1"]);
  });
});
