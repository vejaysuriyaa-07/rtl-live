import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { combinationalLoopNets, multipleDriverReport, multiplyDrivenSignals } from "../../src/ir/semantics";
import { structuralToIr } from "../../src/structural/toIr";
import type { StructuralParser } from "../../src/structural/types";
import { FIXTURES, makeTreeSitterParser } from "./helpers";
import { disposeTestBackend, synthFixture, testBackend } from "./synthHelpers";

const SEM = join(FIXTURES, "semantics");
let parser: StructuralParser;
beforeAll(async () => {
  parser = await makeTreeSitterParser();
  await testBackend().preload();
});
afterAll(() => disposeTestBackend());

describe("semantic warnings", () => {
  it("multi_driver.v: y is marked in the structural view and reported as an error", async () => {
    const text = readFileSync(join(SEM, "multi_driver.v"), "utf8");
    const file = parser.parse(text);
    expect(multiplyDrivenSignals(file.modules[0]!)).toEqual(["y"]);
    const doc = structuralToIr(file, { sourceUri: "t", generation: 1, top: "top_module" });
    const y = doc.modules["top_module"]!.nets.find((n) => n.name === "y")!;
    expect(y.warnings).toEqual(["multiple drivers"]);
    const err = doc.diagnostics.find((d) => d.severity === "error")!;
    expect(err.message).toBe("y has multiple drivers");
    expect(err.line).toBe(4);
    // Yosys merges the drivers silently; the synthesized views carry the structural finding.
    const res = await synthFixture(parser, text, "multi_driver.v");
    expect(res.ok).toBe(true);
    expect(res.doc!.diagnostics.some((d) => d.message === "y has multiple drivers")).toBe(true);
  });

  it("comb_loop.v: the loop through a gets a warning in the structural and the RTL view", async () => {
    const text = readFileSync(join(SEM, "comb_loop.v"), "utf8");
    const file = parser.parse(text);
    const doc = structuralToIr(file, { sourceUri: "t", generation: 1, top: "top_module" });
    const sv = doc.modules["top_module"]!;
    expect([...combinationalLoopNets(sv)]).toEqual(["net:a"]);
    expect(sv.nets.find((n) => n.name === "a")!.warnings).toEqual(["combinational loop"]);
    expect(doc.diagnostics.some((d) => d.severity === "warning" && /combinational loop through a/.test(d.message))).toBe(true);
    const res = await synthFixture(parser, text, "comb_loop.v");
    expect(res.ok).toBe(true);
    const rv = res.doc!.modules["top_module"]!;
    const looped = rv.nets.filter((n) => n.warnings?.includes("combinational loop"));
    expect(looped.length).toBeGreaterThan(0);
    expect(looped.some((n) => n.name === "a" || n.aliases?.includes("a"))).toBe(true);
  });

  it("a flop breaks the loop: counter4 has no loop warning", async () => {
    const text = readFileSync(join(FIXTURES, "hdlbits", "counter4.v"), "utf8");
    const res = await synthFixture(parser, text, "counter4.v");
    expect(res.doc!.modules["top_module"]!.nets.every((n) => !n.warnings)).toBe(true);
    expect(res.doc!.diagnostics).toEqual([]);
  });
});

// Mutation run (2026-10-23): the bit-range arithmetic of the multiple-driver report had no direct tests.
describe("multiple drivers on bit ranges", () => {
  const report = (body: string, decl = "output [7:0] y") => multipleDriverReport(parser.parse(`module t(input [7:0] a, input [7:0] b, ${decl});\n${body}\nendmodule\n`).modules[0]!);

  it("disjoint slices are fine; overlapping slices name the shared bits", () => {
    expect(report("  assign y[3:0] = a[3:0];\n  assign y[7:4] = b[3:0];")).toEqual([]);
    const r = report("  assign y[5:2] = a[3:0];\n  assign y[3:0] = b[3:0];");
    expect(r.map((f) => [f.name, f.bits])).toEqual([["y", "[3:2]"]]);
    expect(r[0]!.srcs.map((s) => s.line)).toEqual([2, 3]);
  });

  it("a whole-vector write against a slice names the slice, and a reversed range still counts bits", () => {
    expect(report("  assign y = a;\n  assign y[0] = b[0];").map((f) => f.bits)).toEqual(["[0]"]);
    expect(report("  assign y[7:4] = a[3:0];\n  assign y[5:2] = b[3:0];", "output [0:7] y").map((f) => f.bits)).toEqual(["[5:4]"]);
    expect(report("  assign y[6] = a[0];\n  assign y[6] = b[0];\n  assign y[1:0] = a[1:0];\n  assign y[0] = b[0];").map((f) => f.bits)).toEqual(["[6], [0]"]);
  });

  it("a clash over every bit, or over whole signals, reports no bit list", () => {
    expect(report("  assign y[7:0] = a;\n  assign y[7:0] = b;").map((f) => f.bits)).toEqual([undefined]);
    expect(report("  assign y = a;\n  assign y = b;").map((f) => f.bits)).toEqual([undefined]);
    expect(report("  assign y = a;\n  assign y = b;", "output y").map((f) => [f.name, f.bits])).toEqual([["y", undefined]]);
  });

  it("a slice outside the declared range is not a clash, and an undeclared name is a plain clash", () => {
    expect(report("  assign y = a;\n  assign y[9] = b[0];", "output [3:0] y")).toEqual([]);
    expect(report("  assign y = a;\n  assign y[2] = b[0];", "output [3:0] y").map((f) => f.bits)).toEqual(["[2]"]);
    expect(report("  assign q = a;\n  assign q[2] = b[0];", "output y").map((f) => [f.name, f.bits])).toEqual([["q", "[2]"]]);
  });
});
