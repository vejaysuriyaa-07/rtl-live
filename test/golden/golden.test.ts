// Golden IR snapshots: test/golden/<fixture>.ir.json (sorted keys, no timestamps).
// Update only for reviewed changes with: npm run test:golden:update
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StructuralParser } from "../../src/structural/types";
import { HDLBITS, makeTreeSitterParser, readFixture } from "../unit/helpers";
import { SYNTH_FIXTURES_BY_MILESTONE, activeMilestones, disposeTestBackend, synthFixture, testBackend } from "../unit/synthHelpers";

const GOLDEN_DIR = __dirname;
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

let parser: StructuralParser;
beforeAll(async () => {
  parser = await makeTreeSitterParser();
  await testBackend().preload();
});
afterAll(() => disposeTestBackend());

const milestones = activeMilestones();

describe("golden IR", () => {
  for (const m of milestones) {
    for (const name of SYNTH_FIXTURES_BY_MILESTONE[m] ?? []) {
      it(`${name} matches ${name.replace(/\.v$/, ".ir.json")}`, async () => {
        const res = await synthFixture(parser, readFixture(HDLBITS, name), name);
        expect(res.ok, res.error?.message).toBe(true);
        // Strip per-run fields so the snapshot has no timestamps or generations.
        const doc = { ...res.doc!, generation: 0, sourceUri: name };
        const text = `${JSON.stringify(sortKeys(doc), null, 2)}\n`;
        const file = join(GOLDEN_DIR, name.replace(/\.v$/, ".ir.json"));
        if (UPDATE || !existsSync(file)) {
          mkdirSync(GOLDEN_DIR, { recursive: true });
          writeFileSync(file, text);
        }
        expect(text).toBe(readFileSync(file, "utf8"));
      });
    }
  }
});
