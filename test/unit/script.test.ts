import { describe, expect, it } from "vitest";
import { buildScript, sanitizeExtraPasses } from "../../src/synth/script";

describe("yosys script", () => {
  it("matches the specified pass list", () => {
    expect(buildScript({ top: "top_module", view: "gate", hasBlackboxes: false, optimize: false, procNorom: true, noScopeInfo: true })).toBe(
      "read_verilog -sv input.v\nhierarchy -top top_module\nproc -norom\nopt_clean\nopt_expr -mux_undef\nopt_clean\nwrite_json -noscopeinfo out.json\n",
    );
    expect(buildScript({ top: "top_module", view: "rtl", hasBlackboxes: false, optimize: false, procNorom: true, noScopeInfo: true })).toBe(
      "read_verilog -sv input.v\nhierarchy -top top_module\nproc -norom\nopt_clean\nopt_dff\nopt_clean\nwrite_json -noscopeinfo out.json\n",
    );
  });
  it("reads stubs, inserts opt -fast and extra passes, and can drop unsupported flags", () => {
    const s = buildScript({ top: "t", view: "gate", hasBlackboxes: true, optimize: true, extraPasses: "wreduce; clean ", procNorom: false, noScopeInfo: false });
    expect(s.split("\n")).toEqual([
      "read_verilog -sv input.v",
      "read_verilog -sv blackboxes.v",
      "hierarchy -top t",
      "proc",
      "opt_clean",
      "opt_expr -mux_undef",
      "opt_clean",
      "opt -fast",
      "wreduce",
      "clean",
      "write_json out.json",
      "",
    ]);
  });
  it("never runs techmap, synth, abc or flatten and rejects bad top names", () => {
    const s = buildScript({ top: "top_module", view: "rtl", hasBlackboxes: false, optimize: true, procNorom: true, noScopeInfo: true });
    expect(s).not.toMatch(/\b(techmap|synth|abc|flatten)\b/);
    expect(() => buildScript({ top: "bad name; shell", view: "gate", hasBlackboxes: false, optimize: false, procNorom: true, noScopeInfo: true })).toThrow();
    expect(sanitizeExtraPasses("a\nb; c ;;")).toEqual(["c"]);
  });
});
