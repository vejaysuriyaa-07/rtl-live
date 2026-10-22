// Dev helper: print the structural model of a file with both parsers.
// usage: node scripts/dump-structural.mjs path/to/file.v [ports|full]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const file = process.argv[2];
const mode = process.argv[3] ?? "full";
const root = resolve(new URL(".", import.meta.url).pathname, "..");

const result = await build({
  stdin: {
    contents: `
      export { loadVerilogLanguage, newParser } from "./src/structural/grammar";
      export { TreeSitterStructuralParser } from "./src/structural/treeSitterParser";
      export { FallbackStructuralParser } from "./src/structural/fallbackScanner";
      export { selectTop } from "./src/structural/topSelect";
      export { structuralToIr } from "./src/structural/toIr";
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: `${root}/artifacts/dump-structural.bundle.mjs`,
  mainFields: ["module", "main"],
});
void result;
const mod = await import(`${root}/artifacts/dump-structural.bundle.mjs`);
const text = readFileSync(file, "utf8");
const lang = await mod.loadVerilogLanguage({ runtimeDir: `${root}/node_modules/web-tree-sitter`, grammarPath: `${root}/assets/wasm/tree-sitter-verilog.wasm` });
const parsers = [new mod.TreeSitterStructuralParser(mod.newParser(lang)), new mod.FallbackStructuralParser()];
for (const p of parsers) {
  const f = p.parse(text);
  if (mode === "ports") {
    const top = mod.selectTop({ modules: f.modules });
    const m = f.modules.find((x) => x.name === top);
    console.log(p.name, JSON.stringify({ top, ports: m?.ports.map((q) => ({ name: q.name, direction: q.direction, width: q.width })) }));
  } else if (mode === "ir") {
    const top = mod.selectTop({ modules: f.modules });
    console.log(p.name, JSON.stringify(mod.structuralToIr(f, { sourceUri: file, generation: 1, top }), null, 1));
  } else {
    console.log(`==== ${p.name}`);
    console.log(JSON.stringify(f, null, 1));
  }
}
