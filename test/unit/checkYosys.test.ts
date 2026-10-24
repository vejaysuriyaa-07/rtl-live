// scripts/check-yosys.mjs: CI gate for the native Yosys step. Old builds (apt
// ships 0.33 on Ubuntu 24.04) reject "write_json -noscopeinfo", so the step
// must be skipped with a notice instead of failing on a syntax error.
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { ROOT } from "./helpers";

interface CheckYosys {
  MIN_YOSYS: string;
  parseYosysVersion(output: string): string | undefined;
  compareVersions(a: string, b: string): number;
  yosysIsRecentEnough(output: string, min?: string): boolean;
}

async function load(): Promise<CheckYosys> {
  return (await import(/* @vite-ignore */ join(ROOT, "scripts", "check-yosys.mjs"))) as CheckYosys;
}

describe("check-yosys", () => {
  it("reads the version out of yosys -V", async () => {
    const m = await load();
    expect(m.parseYosysVersion("Yosys 0.33 (git sha1 2584903a060, gcc 13.2.0-4ubuntu3 -fPIC -Os)")).toBe("0.33");
    expect(m.parseYosysVersion("Yosys 0.70+12 (git sha1 abcdef0)\n")).toBe("0.70+12");
    expect(m.parseYosysVersion("")).toBeUndefined();
    expect(m.parseYosysVersion("yosys: command not found")).toBeUndefined();
  });

  it("compares versions numerically, ignoring the +N commit suffix", async () => {
    const m = await load();
    expect(m.compareVersions("0.33", "0.40")).toBeLessThan(0);
    expect(m.compareVersions("0.70+12", "0.40")).toBeGreaterThan(0);
    expect(m.compareVersions("0.40", "0.40")).toBe(0);
    expect(m.compareVersions("1.0", "0.99")).toBeGreaterThan(0);
    expect(m.compareVersions("0.9", "0.33")).toBeLessThan(0);
  });

  it("accepts a current build and rejects apt's 0.33 or no yosys at all", async () => {
    const m = await load();
    expect(m.yosysIsRecentEnough("Yosys 0.70+12 (git sha1 abcdef0)")).toBe(true);
    expect(m.yosysIsRecentEnough(`Yosys ${m.MIN_YOSYS} (git sha1 abcdef0)`)).toBe(true);
    expect(m.yosysIsRecentEnough("Yosys 0.33 (git sha1 2584903a060)")).toBe(false);
    expect(m.yosysIsRecentEnough("")).toBe(false);
  });
});
