import { beforeAll, describe, expect, it } from "vitest";
import { collectStubs, stubsToVerilog } from "../../src/synth/blackboxStubs";
import type { StructuralParser } from "../../src/structural/types";
import { HDLBITS, bothParsers, readFixture } from "./helpers";

let parsers: StructuralParser[] = [];
beforeAll(async () => {
  parsers = await bothParsers();
});

function stubsFor(parser: StructuralParser, name: string) {
  const file = parser.parse(readFixture(HDLBITS, name));
  return collectStubs(file, "top_module").map((s) => ({ type: s.moduleType, ports: s.ports.map((p) => `${p.direction} ${p.name}${p.width > 1 ? `[${p.width}]` : ""}`) }));
}

describe.each(["tree-sitter", "fallback"] as const)("black-box stubs: %s", (which) => {
  const parser = (): StructuralParser => parsers.find((p) => p.name === which)!;

  it("module.v: named connections to top ports", () => {
    expect(stubsFor(parser(), "module.v")).toEqual([{ type: "mod_a", ports: ["input in1", "input in2", "output out"] }]);
  });
  it("module_pos.v: positional pins p0..p5 with outputs first", () => {
    expect(stubsFor(parser(), "module_pos.v")).toEqual([{ type: "mod_a", ports: ["output p0", "output p1", "input p2", "input p3", "input p4", "input p5"] }]);
  });
  it("module_name.v: pin order follows connection order", () => {
    expect(stubsFor(parser(), "module_name.v")).toEqual([{ type: "mod_a", ports: ["output out1", "output out2", "input in1", "input in2", "input in3", "input in4"] }]);
  });
  it("module_shift.v: q pins drive wires read by the next instance", () => {
    expect(stubsFor(parser(), "module_shift.v")).toEqual([{ type: "my_dff", ports: ["input clk", "input d", "output q"] }]);
  });
  it("module_shift8.v: 8-bit pins and q read by the always block", () => {
    expect(stubsFor(parser(), "module_shift8.v")).toEqual([{ type: "my_dff8", ports: ["input clk", "input d[8]", "output q[8]"] }]);
  });
  it("module_add.v: slices, constant cin, empty cout", () => {
    expect(stubsFor(parser(), "module_add.v")).toEqual([{ type: "add16", ports: ["input a[16]", "input b[16]", "input cin", "output sum[16]", "output cout"] }]);
  });
  it("module_add_full.v: add16 is defined, so no stubs", () => {
    expect(stubsFor(parser(), "module_add_full.v")).toEqual([]);
  });
  it("emits blackbox verilog", () => {
    const v = stubsToVerilog(collectStubs(parser().parse(readFixture(HDLBITS, "module_add.v")), "top_module"));
    expect(v).toBe("(* blackbox *) module add16(input [15:0] a, input [15:0] b, input cin, output [15:0] sum, output cout);\nendmodule\n");
  });
});
