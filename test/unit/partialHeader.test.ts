// ACCURACY.md 5.3: half-typed headers still yield the module and its ports, with both parsers.
import { beforeAll, describe, expect, it } from "vitest";
import type { StructuralParser } from "../../src/structural/types";
import { bothParsers } from "./helpers";

let parsers: StructuralParser[];
beforeAll(async () => {
  parsers = await bothParsers();
});

describe("partial headers", () => {
  for (const [text, ports] of [
    ["module top_module(", []],
    ["module top_module(input a, output b", [["a", "input"], ["b", "output"]]],
    ["module top_module(input a, output b\n", [["a", "input"], ["b", "output"]]],
  ] as const) {
    it(`${JSON.stringify(text)} gives top_module with ports ${JSON.stringify(ports)}`, () => {
      for (const p of parsers) {
        const file = p.parse(text);
        expect(file.modules.map((m) => m.name), p.name).toEqual(["top_module"]);
        expect(file.modules[0]!.ports.map((x) => [x.name, x.direction]), p.name).toEqual(ports);
        expect(file.hasErrors, p.name).toBe(true);
      }
    });
  }
});
