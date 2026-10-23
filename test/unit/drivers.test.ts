// Bug 16: driver analysis is bit-accurate. Two assigns to disjoint slices of one
// vector are legal and draw as a join; overlapping bits are reported with the bits named.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { multipleDriverReport, multiplyDrivenSignals } from "../../src/ir/semantics";
import { parseLvalue } from "../../src/structural/lvalues";
import { structuralToIr } from "../../src/structural/toIr";
import type { StructuralParser } from "../../src/structural/types";
import { HDLBITS, bothParsers } from "./helpers";

let parsers: StructuralParser[];
beforeAll(async () => {
  parsers = await bothParsers();
});

describe("lvalue parsing", () => {
  it("reads names, bit selects, part selects and concatenations", () => {
    expect(parseLvalue("out_not[5:3]")).toEqual([{ name: "out_not", msb: 5, lsb: 3 }]);
    expect(parseLvalue("q[2]")).toEqual([{ name: "q", msb: 2, lsb: 2 }]);
    expect(parseLvalue("x[4 +: 2]")).toEqual([{ name: "x", msb: 5, lsb: 4 }]);
    expect(parseLvalue("x[5 -: 2]")).toEqual([{ name: "x", msb: 5, lsb: 4 }]);
    expect(parseLvalue("{cout, sum[3:0]}")).toEqual([{ name: "cout" }, { name: "sum", msb: 3, lsb: 0 }]);
    expect(parseLvalue("{a, {b, c}}")).toEqual([{ name: "a" }, { name: "b" }, { name: "c" }]);
    expect(parseLvalue("q[i]")).toEqual([{ name: "q" }]);
    expect(parseLvalue("mem[3][7:0]")).toEqual([{ name: "mem" }]);
  });
});

function parseAll(text: string): { parser: StructuralParser; module: ReturnType<StructuralParser["parse"]>["modules"][number] }[] {
  return parsers.map((parser) => ({ parser, module: parser.parse(text).modules[0]! }));
}

describe("multiple drivers, bit accurate", () => {
  it("two assigns to disjoint slices of one vector are not multiple drivers", () => {
    const text = readFileSync(join(HDLBITS, "vectorgates_slices.v"), "utf8");
    for (const { parser, module } of parseAll(text)) {
      expect(multiplyDrivenSignals(module), parser.name).toEqual([]);
    }
  });

  it("two assigns to overlapping bits name the overlapping bits", () => {
    const text = "module top_module(input [7:0] a, input [7:0] b, output [7:0] y);\n  assign y[3:0] = a[3:0];\n  assign y[5:2] = b[3:0];\nendmodule\n";
    for (const { parser, module } of parseAll(text)) {
      const report = multipleDriverReport(module);
      expect(report.map((r) => [r.name, r.bits]), parser.name).toEqual([["y", "[3:2]"]]);
      expect(multiplyDrivenSignals(module), parser.name).toEqual(["y"]);
      const doc = structuralToIr({ modules: [module], errors: [], hasErrors: false, parser: parser.name }, { sourceUri: "t", generation: 1, top: "top_module" });
      const err = doc.diagnostics.find((d) => d.severity === "error");
      expect(err?.message, parser.name).toBe("y[3:2] has multiple drivers");
      expect(err?.line, parser.name).toBe(3);
      const y = doc.modules["top_module"]!.nets.find((n) => n.name === "y");
      expect(y?.warnings, parser.name).toEqual(["multiple drivers on y[3:2]"]);
    }
  });

  it("whole-signal drivers keep the plain message and a scattered overlap lists every range", () => {
    const whole = "module top_module(input a, input b, output y);\n  assign y = a;\n  assign y = b;\nendmodule\n";
    for (const { parser, module } of parseAll(whole)) {
      expect(multipleDriverReport(module).map((r) => [r.name, r.bits]), parser.name).toEqual([["y", undefined]]);
    }
    const scattered = "module top_module(input [7:0] a, output [7:0] y);\n  assign y = a;\n  assign y[0] = 1'b0;\n  assign y[6:5] = 2'b11;\nendmodule\n";
    for (const { parser, module } of parseAll(scattered)) {
      expect(multipleDriverReport(module).map((r) => [r.name, r.bits]), parser.name).toEqual([["y", "[6:5], [0]"]]);
    }
  });

  it("always blocks count per block, with their own slices", () => {
    const text = "module top_module(input a, input b, output reg [1:0] q);\n  always @(*) q[0] = a;\n  always @(*) q[1] = b;\nendmodule\n";
    for (const { parser, module } of parseAll(text)) {
      expect(multiplyDrivenSignals(module), parser.name).toEqual([]);
    }
    const clash = "module top_module(input a, input b, output reg [1:0] q);\n  always @(*) q[0] = a;\n  assign q[0] = b;\nendmodule\n";
    for (const { parser, module } of parseAll(clash)) {
      expect(multipleDriverReport(module).map((r) => [r.name, r.bits]), parser.name).toEqual([["q", "[0]"]]);
    }
  });

  it("a declared range with a nonzero base is honoured", () => {
    const text = "module top_module(input [3:0] a, output [7:4] y);\n  assign y[7:6] = a[1:0];\n  assign y[5:4] = a[3:2];\nendmodule\n";
    for (const { parser, module } of parseAll(text)) {
      expect(multiplyDrivenSignals(module), parser.name).toEqual([]);
    }
  });
});

describe("structural view of slice assigns", () => {
  it("draws one cloud per assign and a join into the full vector", () => {
    const text = readFileSync(join(HDLBITS, "vectorgates_slices.v"), "utf8");
    for (const { parser, module } of parseAll(text)) {
      const doc = structuralToIr({ modules: [module], errors: [], hasErrors: false, parser: parser.name }, { sourceUri: "t", generation: 1, top: "top_module" });
      const v = doc.modules["top_module"]!;
      const clouds = v.nodes.filter((n) => n.kind === "cloud" && n.label.startsWith("out_not"));
      expect(clouds.map((c) => c.label).sort(), parser.name).toEqual(["out_not[2:0] = ~a", "out_not[5:3] = ~b"]);
      expect(new Set(v.nodes.map((n) => n.id)).size, parser.name).toBe(v.nodes.length);
      const joinNode = v.nodes.find((n) => n.kind === "join");
      expect(joinNode, parser.name).toBeDefined();
      expect(joinNode!.pins.filter((p) => p.direction === "in").map((p) => p.bits), parser.name).toEqual(["[5:3]", "[2:0]"]);
      const outNot = v.nets.find((n) => n.name === "out_not")!;
      expect(outNot.width, parser.name).toBe(6);
      expect(outNot.driver?.node, parser.name).toBe(joinNode!.id);
      expect(outNot.warnings, parser.name).toBeUndefined();
      expect(doc.diagnostics, parser.name).toEqual([]);
    }
  });
});
