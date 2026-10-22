import { describe, expect, it } from "vitest";
import { isConstLiteral, literalWidth, parseRange, selectWidth } from "../../src/structural/width";
import { analyzeAlwaysText, extractIdentifiers, splitTopLevel } from "../../src/structural/textUtils";

describe("width helpers", () => {
  it("parses literal ranges", () => {
    expect(parseRange("[7:0]")).toEqual({ width: 8, range: "[7:0]" });
    expect(parseRange("[0:7]")).toEqual({ width: 8, range: "[0:7]" });
    expect(parseRange("[ 2 : 0 ]")).toEqual({ width: 3, range: "[2:0]" });
  });
  it("marks non-literal ranges as unknown width", () => {
    expect(parseRange("[N-1:0]")).toEqual({ width: 0, range: "[N-1:0]" });
  });
  it("literal widths", () => {
    expect(literalWidth("4'd5")).toBe(4);
    expect(literalWidth("1'b0")).toBe(1);
    expect(literalWidth("abc")).toBeUndefined();
    expect(isConstLiteral("1'b0")).toBe(true);
    expect(isConstLiteral("a")).toBe(false);
  });
  it("select widths", () => {
    expect(selectWidth("[15:8]")).toBe(8);
    expect(selectWidth("[3]")).toBe(1);
    expect(selectWidth("[i]")).toBeUndefined();
  });
});

describe("text utils", () => {
  it("extracts identifiers without keywords and literals", () => {
    expect(extractIdentifiers("a & ~b[0] | 4'd5 + c")).toEqual(["a", "b", "c"]);
    expect(extractIdentifiers("{4{a}} // c\n")).toEqual(["a"]);
  });
  it("splits at top level", () => {
    expect(splitTopLevel(".a(x[1:0]), .b({c, d})", ",")).toEqual([".a(x[1:0])", " .b({c, d})"]);
  });
  it("analyzes always blocks", () => {
    const s = analyzeAlwaysText("always @(posedge clk) if (reset) q <= 4'd0; else q <= q + 4'd1;", { line: 1, column: 1, endLine: 1, endColumn: 1 });
    expect(s.kind).toBe("seq");
    expect(s.clocks).toEqual(["clk"]);
    expect(s.assigned).toEqual(["q"]);
    expect(s.read).toEqual(["reset", "q"]);
    const c = analyzeAlwaysText("always @(*) begin case (sel) 2'd0: q = d; default: q = q1; endcase end", { line: 1, column: 1, endLine: 1, endColumn: 1 });
    expect(c.kind).toBe("comb");
    expect(c.assigned).toEqual(["q"]);
    expect(c.read).toEqual(["sel", "d", "q1"]);
  });
});
