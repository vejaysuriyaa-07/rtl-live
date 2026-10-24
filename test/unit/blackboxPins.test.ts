// Mutation run (2026-10-23): the structural view's pin direction inference for instances of
// undefined modules was never asserted; this pins every rule in order.
import { beforeAll, describe, expect, it } from "vitest";
import { structuralToIr } from "../../src/structural/toIr";
import type { StructuralParser } from "../../src/structural/types";
import { makeTreeSitterParser } from "./helpers";

let parser: StructuralParser;
beforeAll(async () => {
  parser = await makeTreeSitterParser();
});

function pins(text: string, inst: string): Record<string, string> {
  const file = parser.parse(text);
  const doc = structuralToIr(file, { sourceUri: "t", generation: 1, top: "top" });
  const node = doc.modules["top"]!.nodes.find((n) => n.id === `inst:${inst}`)!;
  expect(node, `instance ${inst}`).toBeDefined();
  return Object.fromEntries(node.pins.map((p) => [p.id, `${p.direction}:${p.side}:${p.width}:${p.net ?? "none"}`]));
}

describe("black-box pin direction", () => {
  it("inputs feed in, undriven outputs and wires come out, driven wires feed in, constants and empties", () => {
    const text = [
      "module top(input a, input [3:0] v, output y, output z, output [1:0] zz);",
      "  wire w, u;",
      "  assign w = a;",
      "  blk u1(.i(a), .o(y), .d(w), .f(u), .c(1'b0), .n(), .e(a & w), .q(z), .m(w | u), .g(z & y), .k(zz[1:0]));",
      "endmodule",
    ].join("\n");
    const p = pins(text, "u1");
    expect(p["i"]).toBe("in:west:1:net:a");
    expect(p["o"]).toBe("out:east:1:net:y");
    expect(p["d"]).toBe("in:west:1:net:w");
    expect(p["f"]).toBe("out:east:1:net:u");
    expect(p["c"]).toBe("in:west:1:const:u1.c");
    expect(p["n"]).toBe("out:east:1:none");
    expect(p["e"]).toBe("in:west:1:expr:u1.e");
    expect(p["q"]).toBe("out:east:1:net:z");
    expect(p["m"]).toBe("in:west:1:expr:u1.m");
    expect(p["g"]).toBe("out:east:1:expr:u1.g");
    expect(p["k"]).toBe("out:east:2:expr:u1.k");
    const node = structuralToIr(parser.parse(text), { sourceUri: "t", generation: 1, top: "top" }).modules["top"]!.nodes.find((n) => n.id === "inst:u1")!;
    expect(node.kind).toBe("blackbox");
    expect(node.label).toBe("u1 : blk");
  });

  it("an output driven elsewhere is an input to the instance", () => {
    const text = "module top(input a, output y);\n  assign y = a;\n  blk u2(.p(y));\nendmodule\n";
    expect(pins(text, "u2")["p"]).toBe("in:west:1:net:y");
  });

  it("a defined module gives its formal directions and widths, by name and by position", () => {
    const text = [
      "module sub(input [3:0] p, output q, inout r);",
      "endmodule",
      "module top(input [3:0] x, output y, inout z, output y2);",
      "  sub u1(.q(y), .p(x), .r(z));",
      "  sub u2(x, y2, z);",
      "endmodule",
    ].join("\n");
    const byName = pins(text, "u1");
    expect(byName["p"]).toBe("in:west:4:net:x");
    expect(byName["q"]).toBe("out:east:1:net:y");
    expect(byName["r"]).toBe("inout:west:1:net:z");
    const byPos = pins(text, "u2");
    expect(byPos["p0"]).toBe("in:west:4:net:x");
    expect(byPos["p1"]).toBe("out:east:1:net:y2");
    expect(byPos["p2"]).toBe("inout:west:1:net:z");
    const doc = structuralToIr(parser.parse(text), { sourceUri: "t", generation: 1, top: "top" });
    expect(doc.modules["top"]!.nodes.find((n) => n.id === "inst:u1")!.kind).toBe("instance");
  });
});
