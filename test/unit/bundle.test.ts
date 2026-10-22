// Builds the extension-host bundle with the production options and runs the
// structural parser factory out of it under plain Node. Guards against the
// bundle (cjs, minified) behaving differently from the TypeScript sources that
// the other unit tests import directly: the first vsix shipped a bundle whose
// web-tree-sitter copy threw on import.meta.url and silently fell back to the
// regex scanner, while every source-level test passed.
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extensionOptions } from "../../esbuild.config.mjs";
import type { StructuralParser } from "../../src/structural/types";
import { GRAMMAR_WASM, ROOT, RUNTIME_DIR } from "./helpers";

interface BundleExports {
  createStructuralParser(paths: { runtimeDir: string; grammarPath: string }, onFallback?: (reason: string) => void): Promise<StructuralParser>;
}

async function bundleStructuralFactory(production: boolean): Promise<BundleExports> {
  // Written to disk and loaded with require() so the real cjs loader runs the
  // bundle (dynamic import() and __dirname behave as they do in the extension host).
  const dir = mkdtempSync(join(tmpdir(), "rtl-live-bundle-"));
  const outfile = join(dir, "extension.js");
  const { entryPoints: _entry, outfile: _out, ...options } = extensionOptions(production);
  await build({
    ...options,
    outfile,
    logLevel: "silent",
    absWorkingDir: ROOT,
    stdin: {
      contents: `export { createStructuralParser } from "./src/structural/index";`,
      resolveDir: ROOT,
      loader: "ts",
    },
  });
  return createRequire(outfile)(outfile) as BundleExports;
}

describe("extension bundle", () => {
  for (const production of [false, true]) {
    it(`loads the tree-sitter grammar from the ${production ? "production" : "dev"} bundle`, async () => {
      const { createStructuralParser } = await bundleStructuralFactory(production);
      const reasons: string[] = [];
      const parser = await createStructuralParser({ runtimeDir: RUNTIME_DIR, grammarPath: GRAMMAR_WASM }, (r) => reasons.push(r));
      expect(reasons).toEqual([]);
      expect(parser.name).toBe("tree-sitter");
      const file = parser.parse("module m(input a, output b); assign b = ~a; endmodule");
      expect(file.modules.map((m) => m.name)).toEqual(["m"]);
    });
  }
});
