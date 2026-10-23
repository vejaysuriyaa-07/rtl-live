// Bug 13: every identifier in a broken port list stays visible, ghosted when uncertain.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { structuralToIr } from "../../src/structural/toIr";
import type { StructuralParser } from "../../src/structural/types";
import { HDLBITS, PARTIAL, makeTreeSitterParser } from "./helpers";

let parser: StructuralParser;
beforeAll(async () => {
  parser = await makeTreeSitterParser();
});

const INPUTS = ["p1a", "p1b", "p1c", "p1d", "p1e", "p1f", "p2a", "p2b", "p2c", "p2d"];

describe("port recovery", () => {
  it("two missing commas keep every port, in declaration order, with the swallowed ones tentative", () => {
    const text = readFileSync(join(PARTIAL, "p9_two_missing_commas.v"), "utf8");
    const file = parser.parse(text);
    const m = file.modules[0]!;
    expect(m.ports.map((p) => p.name)).toEqual(["p1a", "p1b", "p1c", "p1d", "p1e", "p1f", "p1y", "p2a", "p2b", "p2c", "p2d", "p2y"]);
    expect(m.ports.filter((p) => p.tentative).map((p) => p.name)).toEqual(["p1c", "p1d", "p1e"]);
    expect(m.ports.find((p) => p.name === "p1c")?.direction).toBe("input");
    const doc = structuralToIr(file, { sourceUri: "t", generation: 1, top: "top_module" });
    const v = doc.modules["top_module"]!;
    const w2 = v.nodes.find((n) => n.label.startsWith("w2 ="))!;
    expect(w2.pins.filter((p) => p.direction === "in").map((p) => p.net).sort()).toEqual(["net:p1a", "net:p1b", "net:p1c"]);
  });

  it("every single-character deletion in the port list of 7458 keeps all untouched port names", () => {
    const text = readFileSync(join(HDLBITS, "7458.v"), "utf8");
    const listStart = text.indexOf("(") + 1;
    const listEnd = text.indexOf(");");
    const failures: string[] = [];
    for (let i = listStart; i < listEnd; i++) {
      const mutated = text.slice(0, i) + text.slice(i + 1);
      const file = parser.parse(mutated);
      const m = file.modules.find((x) => x.name === "top_module") ?? file.modules[0];
      const names = new Set(m?.ports.map((p) => p.name) ?? []);
      // A deletion inside a name, or of the space before it, changes that name; every other name must survive.
      const stillWritten = new Set([...mutated.slice(listStart, listEnd - 1).matchAll(/[A-Za-z_]\w*/g)].map((x) => x[0]));
      const expected = [...INPUTS, "p1y", "p2y"].filter((n) => stillWritten.has(n));
      const missing = expected.filter((n) => !names.has(n));
      if (missing.length > 0) failures.push(`delete ${JSON.stringify(text[i])} at ${i}: missing ${missing.join(" ")} (got ${[...names].join(" ")})`);
    }
    expect(failures).toEqual([]);
  });
});
