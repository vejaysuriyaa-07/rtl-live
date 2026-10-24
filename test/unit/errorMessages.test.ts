import { describe, expect, it } from "vitest";
import { describeSyntaxErrors, friendlyVerilatorMessage, maskCommentsAndStrings, refineErrors } from "../../src/structural/errorMessages";

function first(text: string): { line: number; column: number; message: string } | undefined {
  return describeSyntaxErrors(text)[0];
}

describe("syntax error messages", () => {
  it("masks comments and strings without moving positions", () => {
    const t = 'module m; // ) oops\n/* { */ assign s = "}";\nendmodule';
    const masked = maskCommentsAndStrings(t);
    expect(masked.length).toBe(t.length);
    expect(masked).not.toContain("oops");
    expect(masked.split("\n").length).toBe(3);
    expect(describeSyntaxErrors(t)).toEqual([]);
  });

  it("missing ';' after an assign points at the end of the expression", () => {
    const e = first("module t(input in, output out);\n  assign out = ~in\nendmodule\n");
    expect(e).toEqual({ line: 2, column: 19, message: "missing ';'" });
  });

  it("missing endmodule points at the end of the file", () => {
    const e = describeSyntaxErrors("module t(input in, output out);\n  assign out = ~in;\n");
    expect(e).toEqual([{ line: 2, column: 20, message: "missing endmodule" }]);
  });

  it("an unclosed port list is named, even at the end of the file", () => {
    expect(first("module top_module(input a, output")).toEqual({ line: 1, column: 34, message: "missing ')' to close the port list" });
    const e = describeSyntaxErrors("module t(input a, output b\n  assign b = a;\nendmodule\n");
    expect(e[0]).toEqual({ line: 1, column: 27, message: "missing ')' to close the port list" });
    const w = describeSyntaxErrors("module t(input wire a, output b\n  wire w;\n  assign b = a;\nendmodule\n");
    expect(w[0]).toEqual({ line: 1, column: 32, message: "missing ')' to close the port list" });
  });

  it("missing ',' between ports and ';' after the port list", () => {
    expect(first("module t(input a input b, output y);\n  assign y = a & b;\nendmodule\n")).toEqual({ line: 1, column: 18, message: "missing ',' before 'input'" });
    expect(first("module t(input a, output y)\n  assign y = a;\nendmodule\n")).toEqual({ line: 1, column: 28, message: "missing ';' after the port list" });
  });

  it("an operator with nothing after it is a missing operand", () => {
    expect(first("module t(input a, input b, output out);\n  assign out = a &\n")).toEqual({ line: 2, column: 19, message: "missing operand after '&'" });
    expect(first("module t(input a, input b, output out);\n  assign out = a &;\nendmodule\n")).toEqual({ line: 2, column: 19, message: "missing operand after '&'" });
    expect(first("module t(input [1:0] a, input b, output out);\n  assign out = a[0] & b;\nendmodule\n")).toBeUndefined();
  });

  it("unclosed begin and unclosed instance connections", () => {
    const e = describeSyntaxErrors("module t(input clk, input d, output reg q);\n  always @(posedge clk) begin\n    q <= d;\n");
    expect(e.map((x) => x.message)).toEqual(["missing end", "missing endmodule"]);
    expect(e[0]).toMatchObject({ line: 3, column: 12 });
    const i = describeSyntaxErrors("module t(input a, input b, output out);\n  mod_a u1(.in1(a), .in2(\n");
    expect(i[0]).toEqual({ line: 2, column: 26, message: "missing ')' to close the connection to 'in2'" });
  });

  it("missing ';' inside an always block and a clean file has no issues", () => {
    const e = describeSyntaxErrors("module t(input clk, input d, output reg q);\n  always @(posedge clk) begin\n    q <= d\n  end\nendmodule\n");
    expect(e).toEqual([{ line: 3, column: 11, message: "missing ';'" }]);
    expect(describeSyntaxErrors("module m(input [3:0] a, output [3:0] y);\n  wire [3:0] t = a ^ 4'b1010;\n  assign y = {t[2:0], a[3]};\n  my_dff8 u1(.clk(a[0]), .d(t), .q());\nendmodule\n")).toEqual([]);
  });

  it("refineErrors keeps tree-sitter MISSING tokens and rewrites generic errors", () => {
    expect(refineErrors("module m(input a, output y);\n  assign y = (a;\nendmodule\n", [{ line: 2, column: 16, message: "missing )" }])).toEqual([{ line: 2, column: 16, message: "missing ')'" }]);
    expect(refineErrors("foo bar baz", [{ line: 1, column: 1, message: "syntax error" }])).toEqual([{ line: 1, column: 1, message: "syntax error near 'foo'" }]);
    const r = refineErrors("module t(input in, output out);\n  assign out = ~in\nendmodule\n", [{ line: 1, column: 1, message: "syntax error" }]);
    expect(r).toEqual([{ line: 2, column: 19, message: "missing ';'" }]);
  });

  it("rewrites Verilator wording", () => {
    expect(friendlyVerilatorMessage("syntax error, unexpected endmodule, expecting ';'")).toBe("missing ';' before 'endmodule'");
    expect(friendlyVerilatorMessage("syntax error, unexpected ')', expecting IDENTIFIER or ','")).toBe("missing 'IDENTIFIER' before ')'");
    expect(friendlyVerilatorMessage("syntax error, unexpected end of file")).toBe("unexpected 'end of file'");
  });
});

describe("bug 22: an unfinished statement beats the missing endmodule", () => {
  it("a lone assign is explained first, missing endmodule listed second at the same spot", () => {
    const e = describeSyntaxErrors("module t(input a, output b);\n\nassign\n");
    expect(e[0]).toEqual({ line: 3, column: 7, message: "assign is incomplete: write assign name = expression;" });
    expect(e[1]).toEqual({ line: 3, column: 7, message: "missing endmodule" });
  });

  it("assign with a name but no '=' is incomplete too, and the parser's errors keep that order", () => {
    const text = "module t(input a, output b);\n  assign b\nendmodule\n";
    expect(first(text)).toEqual({ line: 2, column: 11, message: "assign is incomplete: write assign name = expression;" });
    const refined = refineErrors("module t(input a, output b);\n\nassign\n", [{ line: 1, column: 1, message: "syntax error" }]);
    expect(refined.map((r) => r.message)).toEqual(["assign is incomplete: write assign name = expression;", "missing endmodule"]);
  });

  it("a complete assign without ';' still says missing ';'", () => {
    expect(first("module t(input a, output b);\n  assign b = a\nendmodule\n")).toEqual({ line: 2, column: 15, message: "missing ';'" });
  });
});
