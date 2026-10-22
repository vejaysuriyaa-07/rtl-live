import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { FallbackStructuralParser } from "../../src/structural/fallbackScanner";
import { loadVerilogLanguage, newParser } from "../../src/structural/grammar";
import { TreeSitterStructuralParser } from "../../src/structural/treeSitterParser";
import type { StructuralParser } from "../../src/structural/types";

export const ROOT = resolve(__dirname, "..", "..");
export const FIXTURES = join(ROOT, "test", "fixtures");
export const HDLBITS = join(FIXTURES, "hdlbits");
export const PARTIAL = join(FIXTURES, "partial");
export const EXPECTED = join(FIXTURES, "expected");
export const GRAMMAR_WASM = join(ROOT, "assets", "wasm", "tree-sitter-verilog.wasm");
export const RUNTIME_DIR = join(ROOT, "node_modules", "web-tree-sitter");

export function listFixtures(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".v"))
    .sort();
}

export function readFixture(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

export function readExpected(name: string): Record<string, unknown> | undefined {
  const p = join(EXPECTED, name.replace(/\.v$/, ".json"));
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

export async function makeTreeSitterParser(): Promise<StructuralParser> {
  const lang = await loadVerilogLanguage({ runtimeDir: RUNTIME_DIR, grammarPath: GRAMMAR_WASM });
  return new TreeSitterStructuralParser(newParser(lang));
}

export function makeFallbackParser(): StructuralParser {
  return new FallbackStructuralParser();
}

export async function bothParsers(): Promise<StructuralParser[]> {
  return [await makeTreeSitterParser(), makeFallbackParser()];
}
