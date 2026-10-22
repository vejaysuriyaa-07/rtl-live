// Builds all bundles:
//   dist/extension.js     cjs, node   (extension host)
//   dist/yosysWorker.mjs  esm, node   (worker_threads worker for @yowasp/yosys)
//   dist/webview.js       iife, browser
//   dist/elkWorker.js     iife, browser (ELK layout in a Web Worker)
// Also copies wasm assets into dist/ so the packaged vsix needs no node_modules.
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

mkdirSync("dist", { recursive: true });

/** @type {esbuild.BuildOptions} */
const common = {
  bundle: true,
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info",
  legalComments: "none",
  target: "es2022",
};

const extension = {
  ...common,
  entryPoints: ["src/extension/extension.ts"],
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  external: ["vscode"],
  mainFields: ["module", "main"],
};

const yosysWorker = {
  ...common,
  entryPoints: ["src/synth/yosysWorker.ts"],
  outfile: "dist/yosysWorker.mjs",
  format: "esm",
  platform: "node",
  mainFields: ["module", "main"],
  // @yowasp/yosys resolves its wasm via import.meta.url; copyAssets puts the files next to the bundle.
  banner: { js: "import { createRequire as __rtlCreateRequire } from 'node:module'; const require = __rtlCreateRequire(import.meta.url);" },
};

const webview = {
  ...common,
  entryPoints: ["webview/main.ts"],
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
};

const elkWorker = {
  ...common,
  entryPoints: ["webview/layout/elkWorker.ts"],
  outfile: "dist/elkWorker.js",
  format: "iife",
  platform: "browser",
};

function copyAssets() {
  // web-tree-sitter runtime wasm
  const wts = "node_modules/web-tree-sitter/web-tree-sitter.wasm";
  if (existsSync(wts)) cpSync(wts, "dist/web-tree-sitter.wasm");
  // grammar wasm built by scripts/build-grammar.mjs
  if (existsSync("assets/wasm")) {
    for (const f of readdirSync("assets/wasm")) {
      if (f.endsWith(".wasm")) cpSync(join("assets/wasm", f), join("dist", f));
    }
  }
  // @yowasp/yosys resources (wasm + resource tar) must sit next to dist/yosysWorker.mjs,
  // because the bundle resolves them with new URL("./x", import.meta.url).
  const yowasp = "node_modules/@yowasp/yosys/gen";
  if (existsSync(yowasp) && statSync(yowasp).isDirectory()) {
    for (const f of readdirSync(yowasp)) {
      if (f.endsWith(".wasm") || f.endsWith(".tar")) cpSync(join(yowasp, f), join("dist", f));
    }
  }
}

// Integration tests run inside VS Code via @vscode/test-cli; bundle each to cjs.
const integrationEntries = existsSync("test/integration")
  ? readdirSync("test/integration")
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => join("test/integration", f))
  : [];
const integration = {
  ...common,
  entryPoints: integrationEntries,
  outdir: "dist/test/integration",
  entryNames: "[name]",
  format: "cjs",
  platform: "node",
  external: ["vscode", "mocha"],
};

const configs = [extension, yosysWorker, webview, elkWorker].filter((c) => existsSync(c.entryPoints[0]));
if (integrationEntries.length > 0) configs.push(integration);

if (watch) {
  copyAssets();
  const ctxs = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("[esbuild] watching");
} else {
  copyAssets();
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
