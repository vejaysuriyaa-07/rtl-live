// Mutation run (2026-10-23): flop pin polarity, async load, set and clear pins and the mux
// kinds were only reached through fixtures that never use them.
import { describe, expect, it } from "vitest";
import { cellSpec } from "../../src/ir/cellMap";
import type { YosysCell } from "../../src/synth/yosysJson";

function cell(type: string, conns: string[], parameters: Record<string, string | number> = {}, port_directions?: Record<string, "input" | "output" | "inout">): YosysCell {
  return { type, parameters, connections: Object.fromEntries(conns.map((c, i) => [c, [i + 2]])), ...(port_directions ? { port_directions } : {}) };
}

const pin = (s: ReturnType<typeof cellSpec>, id: string) => s.pins.find((p) => p.id === id);

describe("cellSpec flops", () => {
  it("a plain $dff has D, CLK (south, posedge) and Q", () => {
    const s = cellSpec(cell("$dff", ["CLK", "D", "Q"], { CLK_POLARITY: 1 }));
    expect(s.kind).toBe("dff");
    expect(s.label).toBe("DFF");
    expect(s.op).toBe("dff");
    expect(s.pins.map((p) => p.id)).toEqual(["D", "CLK", "Q"]);
    expect(pin(s, "CLK")).toMatchObject({ side: "south", direction: "in" });
    expect(pin(s, "CLK")!.inverted).toBeUndefined();
    expect(s.info).toEqual({ clock: "posedge" });
    expect(s.warnings).toEqual([]);
  });

  it("CLK_POLARITY 0 inverts the clock pin and says negedge", () => {
    const s = cellSpec(cell("$dff", ["CLK", "D", "Q"], { CLK_POLARITY: "0" }));
    expect(pin(s, "CLK")!.inverted).toBe(true);
    expect(s.info!["clock"]).toBe("negedge");
  });

  it("$adff: async reset pin R, inverted when ARST_POLARITY is 0, value in the info", () => {
    const s = cellSpec(cell("$adff", ["CLK", "D", "ARST", "Q"], { ARST_POLARITY: 0, ARST_VALUE: "0101" }));
    expect(pin(s, "R")).toMatchObject({ conn: "ARST", inverted: true, side: "west" });
    expect(s.info!["reset"]).toBe("async, value 0101");
    const hi = cellSpec(cell("$adff", ["CLK", "D", "ARST", "Q"], { ARST_POLARITY: 1 }));
    expect(pin(hi, "R")!.inverted).toBeUndefined();
    expect(hi.info!["reset"]).toBe("async, value ?");
  });

  it("$sdffe: sync reset and enable, each with its own polarity", () => {
    const s = cellSpec(cell("$sdffe", ["CLK", "D", "EN", "SRST", "Q"], { EN_POLARITY: 0, SRST_POLARITY: 1, SRST_VALUE: 0 }));
    expect(pin(s, "EN")).toMatchObject({ conn: "EN", inverted: true, label: "EN" });
    expect(pin(s, "R")).toMatchObject({ conn: "SRST" });
    expect(pin(s, "R")!.inverted).toBeUndefined();
    expect(s.info!["reset"]).toBe("sync, value 0");
    expect(s.pins.map((p) => p.id)).toEqual(["D", "CLK", "EN", "R", "Q"]);
  });

  it("$aldff has AD and AL pins; $dffsr has S and C; pins appear only when connected", () => {
    const al = cellSpec(cell("$aldff", ["CLK", "D", "AD", "ALOAD", "Q"]));
    expect(al.pins.map((p) => `${p.id}:${p.label}`)).toEqual(["D:D", "CLK:", "AD:AD", "AL:AL", "Q:Q"]);
    const sr = cellSpec(cell("$dffsr", ["CLK", "D", "SET", "CLR", "Q"]));
    expect(sr.pins.map((p) => `${p.id}:${p.label}`)).toEqual(["D:D", "CLK:", "SET:S", "CLR:C", "Q:Q"]);
    const bare = cellSpec(cell("$dff", ["CLK", "D", "Q"]));
    expect(bare.pins.map((p) => p.id)).toEqual(["D", "CLK", "Q"]);
  });

  it("latches: no CLK pin, LATCH label and a latch warning; $sr counts as a latch", () => {
    const l = cellSpec(cell("$dlatch", ["EN", "D", "Q"], { EN_POLARITY: 1 }));
    expect(l.label).toBe("LATCH");
    expect(l.warnings).toEqual(["latch"]);
    expect(l.pins.map((p) => p.id)).toEqual(["D", "EN", "Q"]);
    expect(cellSpec(cell("$sr", ["SET", "CLR", "Q"])).warnings).toEqual(["latch"]);
    expect(cellSpec(cell("$adlatch", ["EN", "D", "ARST", "Q"])).label).toBe("LATCH");
  });
});

describe("cellSpec other kinds", () => {
  it("$pmux and $bmux are pmux nodes with no fixed pins and their own labels", () => {
    expect(cellSpec(cell("$pmux", ["A", "B", "S", "Y"]))).toMatchObject({ kind: "pmux", label: "PMUX", pins: [] });
    expect(cellSpec(cell("$bmux", ["A", "S", "Y"]))).toMatchObject({ kind: "pmux", label: "BMUX", pins: [] });
  });

  it("$neg is a one-input arith node; two-input arith, compare and shift use A and B", () => {
    const neg = cellSpec(cell("$neg", ["A", "Y"]));
    expect(neg.kind).toBe("arith");
    expect(neg.pins.map((p) => p.id)).toEqual(["A", "Y"]);
    expect(cellSpec(cell("$add", ["A", "B", "Y"])).pins.map((p) => p.id)).toEqual(["A", "B", "Y"]);
    expect(cellSpec(cell("$lt", ["A", "B", "Y"])).kind).toBe("compare");
    expect(cellSpec(cell("$shl", ["A", "B", "Y"])).kind).toBe("shift");
  });

  it("logical gates carry info.logical; plain gates do not", () => {
    expect(cellSpec(cell("$logic_not", ["A", "Y"])).info).toEqual({ logical: "1" });
    expect(cellSpec(cell("$logic_and", ["A", "B", "Y"])).info).toEqual({ logical: "1" });
    expect(cellSpec(cell("$not", ["A", "Y"])).info).toBeUndefined();
    expect(cellSpec(cell("$and", ["A", "B", "Y"])).info).toBeUndefined();
  });

  it("an unknown cell type takes its pins and directions from port_directions", () => {
    const s = cellSpec(cell("$strange", ["P", "Q"], {}, { P: "input", Q: "output" }));
    expect(s.kind).toBe("unknown");
    expect(s.op).toBe("strange");
    expect(s.pins.map((p) => `${p.id}:${p.direction}:${p.side}`)).toEqual(["P:in:west", "Q:out:east"]);
    expect(cellSpec(cell("$strange", ["P"])).pins[0]!.direction).toBe("in");
  });
});
