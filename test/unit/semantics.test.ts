import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { combinationalLoopNets, multiplyDrivenSignals } from "../../src/ir/semantics";
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
