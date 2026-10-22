import { beforeAll, describe, expect, it } from "vitest";
import { structuralToIr } from "../../src/structural/toIr";
import { selectTop } from "../../src/structural/topSelect";
import type { StructuralParser } from "../../src/structural/types";
import { HDLBITS, PARTIAL, bothParsers, listFixtures, readExpected, readFixture } from "./helpers";

interface ExpectedPort {
  name: string;
  direction: string;
  width: number;
}

let parsers: StructuralParser[] = [];

beforeAll(async () => {
  parsers = await bothParsers();
});

describe.each(["tree-sitter", "fallback"] as const)("structural parser: %s", (which) => {
  const parser = (): StructuralParser => {
    const p = parsers.find((x) => x.name === which);
    if (!p) throw new Error(`parser ${which} missing`);
    return p;
  };

  describe("hdlbits fixtures", () => {
    for (const name of listFixtures(HDLBITS)) {
      it(`${name}: ports match expected`, () => {
        const expected = readExpected(name);
        expect(expected, `missing expected json for ${name}`).toBeDefined();
        const file = parser().parse(readFixture(HDLBITS, name));
        expect(file.hasErrors, `parse errors: ${JSON.stringify(file.errors)}`).toBe(false);
        const top = selectTop({ modules: file.modules });
        expect(top).toBe(expected!["top"] ?? "top_module");
        const m = file.modules.find((x) => x.name === top)!;
        const ports = m.ports.map((p) => ({ name: p.name, direction: p.direction, width: p.width }));
        expect(ports).toEqual(expected!["ports"] as ExpectedPort[]);
        const st = expected!["structural"] as Record<string, unknown> | undefined;
        if (st) {
          if (st["assigns"] !== undefined) expect(m.assigns.length).toBe(st["assigns"]);
          if (st["always"] !== undefined) expect(m.always.length).toBe(st["always"]);
          if (st["instances"] !== undefined) {
            const inst = m.instances.map((i) => ({ name: i.name, type: i.moduleType, pins: i.connections.map((c) => c.port ?? `p${c.index}`) }));
            expect(inst).toEqual(st["instances"]);
          }
          if (st["modules"] !== undefined) expect(file.modules.map((x) => x.name)).toEqual(st["modules"]);
          if (st["decls"] !== undefined) expect(m.decls.map((d) => d.name)).toEqual(st["decls"]);
          if (st["localparams"] !== undefined) expect(m.localparams.map((d) => d.name)).toEqual(st["localparams"]);
        }
      });
    }
  });

  describe("partial fixtures", () => {
    for (const name of listFixtures(PARTIAL)) {
      it(`${name}: yields a module box (or empty state) and never throws`, () => {
        const text = readFixture(PARTIAL, name);
        const file = parser().parse(text);
        const doc = structuralToIr(file, { sourceUri: name, generation: 1, top: selectTop({ modules: file.modules }) });
        expect(doc.version).toBe(1);
        if (name.startsWith("p8")) {
          expect(file.modules.length).toBe(0);
          expect(doc.top).toBe("");
          return;
        }
        expect(file.modules.length).toBeGreaterThan(0);
        expect(doc.top).not.toBe("");
        expect(doc.modules[doc.top]).toBeDefined();
        const m = file.modules.find((x) => x.name === doc.top)!;
        if (name.startsWith("p1")) expect(m.ports.map((p) => p.name)).toEqual(["a", "b"]);
        if (name.startsWith("p2")) expect(m.ports.map((p) => p.name)).toContain("a");
        if (name.startsWith("p3")) {
          expect(m.ports.map((p) => p.name)).toEqual(["a", "b", "out"]);
          expect(m.assigns.length).toBeLessThanOrEqual(1);
        }
        if (name.startsWith("p4")) {
          expect(m.ports.map((p) => p.name)).toEqual(["in", "out"]);
          expect(m.assigns.length).toBe(1);
        }
        if (name.startsWith("p5")) expect(m.ports.map((p) => p.name)).toEqual(["a", "b", "out"]);
        if (name.startsWith("p6")) {
          expect(m.ports.map((p) => p.name)).toEqual(["clk", "d", "q"]);
          expect(m.always.length).toBe(1);
          expect(m.always[0]!.assigned).toContain("q");
        }
        if (name.startsWith("p7")) {
          expect(file.modules.map((x) => x.name)).toEqual(["good", "top_module"]);
          expect(doc.top).toBe("top_module");
          expect(file.modules[0]!.ports.map((p) => p.name)).toEqual(["x", "y"]);
        }
      });
    }
  });

  describe("robustness: prefixes of every fixture", () => {
    for (const name of listFixtures(HDLBITS)) {
      it(`${name}: 25 prefixes produce a valid SchematicDoc`, () => {
        const text = readFixture(HDLBITS, name);
        for (let k = 1; k <= 25; k++) {
          const len = Math.floor((text.length * k) / 25);
          const prefix = text.slice(0, len);
          const file = parser().parse(prefix);
          const doc = structuralToIr(file, { sourceUri: name, generation: k, top: selectTop({ modules: file.modules }) });
          expect(doc.version).toBe(1);
          expect(Array.isArray(doc.moduleNames)).toBe(true);
          for (const mv of Object.values(doc.modules)) {
            for (const n of mv.nodes) expect(typeof n.id).toBe("string");
          }
        }
      });
    }
  });
});

describe("top selection", () => {
  it("prefers top_module, then the uninstantiated module, then the cursor", async () => {
    const [ts] = await bothParsers();
    const f1 = ts!.parse("module a(input x); endmodule\nmodule top_module(input y); a u(.x(y)); endmodule");
    expect(selectTop({ modules: f1.modules })).toBe("top_module");
    const f2 = ts!.parse("module leaf(input x); endmodule\nmodule root(input y); leaf u(.x(y)); endmodule");
    expect(selectTop({ modules: f2.modules })).toBe("root");
    const f3 = ts!.parse("module m1(input x); endmodule\nmodule m2(input y); endmodule");
    expect(selectTop({ modules: f3.modules, cursorLine: 2 })).toBe("m2");
    expect(selectTop({ modules: f3.modules, override: "m1", cursorLine: 2 })).toBe("m1");
  });

});

describe("recovered ports", () => {
  it("ports inside a broken header are kept and marked tentative", async () => {
    const [ts] = await bothParsers();
    const file = ts!.parse("module t(input a, output b\n  assign b = a;\nendmodule\n");
    const m = file.modules[0]!;
    expect(m.ports.map((p) => p.name)).toEqual(["a", "b"]);
    expect(m.ports.find((p) => p.name === "b")!.tentative).toBe(true);
    expect(m.ports.find((p) => p.name === "a")!.tentative).toBeUndefined();
    expect(file.errors[0]).toEqual({ line: 1, column: 27, message: "missing ')' to close the port list" });
  });
});
