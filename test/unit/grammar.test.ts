import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TREE_SITTER_CLI_VERSION, WEB_TREE_SITTER_VERSION } from "../../src/structural/grammar";
import { GRAMMAR_WASM, ROOT } from "./helpers";

function pkgVersion(name: string): string {
  return (JSON.parse(readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8")) as { version: string }).version;
}

describe("grammar build", () => {
  it("web-tree-sitter and tree-sitter-cli share a minor version", () => {
    const wts = pkgVersion("web-tree-sitter");
    const cli = pkgVersion("tree-sitter-cli");
    expect(wts).toBe(WEB_TREE_SITTER_VERSION);
    expect(cli).toBe(TREE_SITTER_CLI_VERSION);
    expect(wts.split(".").slice(0, 2)).toEqual(cli.split(".").slice(0, 2));
  });

  it("the grammar wasm matches its recorded provenance", () => {
    expect(existsSync(GRAMMAR_WASM)).toBe(true);
    const prov = JSON.parse(readFileSync(join(ROOT, "assets", "wasm", "provenance.json"), "utf8")) as { sha256: string; grammar: { abi: number } };
    const sha = createHash("sha256").update(readFileSync(GRAMMAR_WASM)).digest("hex");
    expect(sha).toBe(prov.sha256);
    expect(prov.grammar.abi).toBeGreaterThanOrEqual(13);
  });
});
