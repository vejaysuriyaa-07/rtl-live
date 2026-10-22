// Benchmarks per fixture: structural parse+IR (both parsers), warm synthesis per
// available backend, ELK layout (elkjs in node) and the wasm cold start.
// Writes artifacts/bench.json and prints a markdown table.
import { build } from "esbuild";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const root = resolve(new URL(".", import.meta.url).pathname, "..");
mkdirSync(join(root, "artifacts"), { recursive: true });

await build({
  stdin: {
    contents: `
      export { loadVerilogLanguage, newParser } from "./src/structural/grammar";
      export { TreeSitterStructuralParser } from "./src/structural/treeSitterParser";
      export { FallbackStructuralParser } from "./src/structural/fallbackScanner";
      export { selectTop } from "./src/structural/topSelect";
      export { structuralToIr } from "./src/structural/toIr";
      export { WasmYosysBackend } from "./src/synth/wasmBackend";
      export { NativeYosysBackend, findYosys } from "./src/synth/nativeBackend";
      export { synthesize } from "./src/synth/synthesize";
      export { DEFAULT_SIMPLIFY } from "./src/ir/simplify";
      export { moduleToElk } from "./webview/layout/toElk";
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(root, "artifacts", "bench.bundle.mjs"),
  mainFields: ["module", "main"],
  external: ["vscode"],
});
const m = await import(join(root, "artifacts", "bench.bundle.mjs"));
const ELK = (await import("elkjs/lib/main.js")).default;
const elk = new ELK();

const fixturesDir = join(root, "test", "fixtures", "hdlbits");
const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith(".v")).sort();

function p95(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}
function stats(xs) {
  return { p50: p95(xs.map((x) => x)) && [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)], p95: p95(xs), max: Math.max(...xs) };
}

const lang = await m.loadVerilogLanguage({ runtimeDir: `${root}/node_modules/web-tree-sitter`, grammarPath: `${root}/assets/wasm/tree-sitter-verilog.wasm` });
const ts = new m.TreeSitterStructuralParser(m.newParser(lang));
const fb = new m.FallbackStructuralParser();

// Cold wasm start: fresh backend, preload.
const coldT0 = performance.now();
const wasm = new m.WasmYosysBackend({ workerPath: `${root}/dist/yosysWorker.mjs` });
await wasm.preload();
const wasmCold = performance.now() - coldT0;
const backends = [{ name: "wasm", be: wasm }];
const nativeBin = m.findYosys(undefined);
if (nativeBin) {
  const native = new m.NativeYosysBackend(nativeBin);
  await native.preload();
  backends.push({ name: "native", be: native });
}

const results = [];
for (const f of fixtures) {
  const text = readFileSync(join(fixturesDir, f), "utf8");
  const row = { fixture: f, structuralTreeSitterMs: {}, structuralFallbackMs: {}, synth: {}, elkMs: {}, nodes: 0 };
  for (const [key, parser] of [["structuralTreeSitterMs", ts], ["structuralFallbackMs", fb]]) {
    const times = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const file = parser.parse(text);
      m.structuralToIr(file, { sourceUri: f, generation: i, top: m.selectTop({ modules: file.modules }) });
      times.push(performance.now() - t0);
    }
    row[key] = stats(times);
  }
  const file = ts.parse(text);
  const top = m.selectTop({ modules: file.modules });
  let doc;
  for (const { name, be } of backends) {
    const times = [];
    for (let i = 0; i < 8; i++) {
      const res = await m.synthesize(be, { view: "rtl", text, file, top, sourceUri: f, generation: i, optimize: false, simplify: m.DEFAULT_SIMPLIFY, timeoutMs: 20000, signal: new AbortController().signal });
      if (!res.ok) throw new Error(`${f}: ${name} failed: ${res.error?.message}`);
      doc = res.doc;
      if (i > 0) times.push(res.elapsedMs); // first run warms the cache paths
    }
    row.synth[name] = stats(times);
  }
  const view = doc.modules[top];
  row.nodes = view.nodes.length;
  const elkTimes = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await elk.layout(m.moduleToElk(view));
    elkTimes.push(performance.now() - t0);
  }
  row.elkMs = stats(elkTimes);
  results.push(row);
  process.stdout.write(".");
}
console.log();
for (const b of backends) b.be.dispose();

const budgets = { structuralP95Ms: 100, nativeP95Ms: 300, wasmWarmP95Ms: 800, wasmColdMs: 8000, elkMs: 100 };
const summary = {
  date: new Date().toISOString(),
  node: process.version,
  wasmColdStartMs: wasmCold,
  backends: backends.map((b) => b.name),
  budgets,
  worst: {
    structuralTreeSitterP95Ms: Math.max(...results.map((r) => r.structuralTreeSitterMs.p95)),
    structuralFallbackP95Ms: Math.max(...results.map((r) => r.structuralFallbackMs.p95)),
    wasmWarmP95Ms: Math.max(...results.map((r) => r.synth.wasm?.p95 ?? 0)),
    nativeWarmP95Ms: nativeBin ? Math.max(...results.map((r) => r.synth.native?.p95 ?? 0)) : null,
    elkMaxMs: Math.max(...results.map((r) => r.elkMs.max)),
  },
  fixtures: results,
};
writeFileSync(join(root, "artifacts", "bench.json"), JSON.stringify(summary, null, 2));

const fmt = (x) => (x === undefined || x === null ? "n/a" : x.toFixed(1));
console.log(`| fixture | nodes | structural ts p95 | structural fallback p95 | wasm warm p95 | ${nativeBin ? "native warm p95 | " : ""}elk max |`);
console.log(`| --- | --- | --- | --- | --- | ${nativeBin ? "--- | " : ""}--- |`);
for (const r of results) {
  console.log(`| ${r.fixture} | ${r.nodes} | ${fmt(r.structuralTreeSitterMs.p95)} | ${fmt(r.structuralFallbackMs.p95)} | ${fmt(r.synth.wasm?.p95)} | ${nativeBin ? `${fmt(r.synth.native?.p95)} | ` : ""}${fmt(r.elkMs.max)} |`);
}
console.log(`wasm cold start: ${wasmCold.toFixed(0)} ms`);
console.log(JSON.stringify(summary.worst));
