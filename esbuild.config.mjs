// Shared esbuild options for every bundle. esbuild.mjs runs them; the bundle
// unit test (test/unit/bundle.test.ts) imports `extension` so the test builds
// the extension host bundle exactly the way the vsix does.
//   dist/extension.js     cjs, node   (extension host)
//   dist/yosysWorker.mjs  esm, node   (worker_threads worker for @yowasp/yosys)
//   dist/webview.js       iife, browser
//   dist/elkWorker.js     iife, browser (ELK layout in a Web Worker)
import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(new URL(".", import.meta.url).pathname);

/**
 * web-tree-sitter 0.27 ships an ESM build (web-tree-sitter.js) that locates
 * itself with `createRequire(import.meta.url)`. Bundled into a cjs file,
 * esbuild rewrites `import.meta` to an empty object, so that call throws
 * "The argument 'filename' must be a file URL object ... Received undefined"
 * and the extension silently fell back to the regex scanner. The package also
 * ships a cjs build that uses __filename/__dirname, which survive cjs bundling.
 * The "require" export condition cannot be forced for an `import` statement,
 * so this plugin points the bare specifier at the cjs file.
 * @type {import("esbuild").Plugin}
 */
export const treeSitterCjsPlugin = {
  name: "web-tree-sitter-cjs",
  setup(build) {
    build.onResolve({ filter: /^web-tree-sitter$/ }, () => ({
      path: join(ROOT, "node_modules", "web-tree-sitter", "web-tree-sitter.cjs"),
    }));
  },
};

/** @returns {import("esbuild").BuildOptions} */
export function commonOptions(production) {
  return {
    bundle: true,
    sourcemap: production ? false : "inline",
    minify: production,
    logLevel: "info",
    legalComments: "none",
    target: "es2022",
  };
}

/** @returns {import("esbuild").BuildOptions} */
export function extensionOptions(production) {
  return {
    ...commonOptions(production),
    entryPoints: ["src/extension/extension.ts"],
    outfile: "dist/extension.js",
    format: "cjs",
    platform: "node",
    external: ["vscode"],
    mainFields: ["module", "main"],
    plugins: [treeSitterCjsPlugin],
  };
}

/** @returns {import("esbuild").BuildOptions} */
export function yosysWorkerOptions(production) {
  return {
    ...commonOptions(production),
    entryPoints: ["src/synth/yosysWorker.ts"],
    outfile: "dist/yosysWorker.mjs",
    format: "esm",
    platform: "node",
    mainFields: ["module", "main"],
    // @yowasp/yosys resolves its wasm via import.meta.url; copyAssets puts the files next to the bundle.
    banner: { js: "import { createRequire as __rtlCreateRequire } from 'node:module'; const require = __rtlCreateRequire(import.meta.url);" },
  };
}

/** @returns {import("esbuild").BuildOptions} */
export function webviewOptions(production) {
  return {
    ...commonOptions(production),
    entryPoints: ["webview/main.ts"],
    outfile: "dist/webview.js",
    format: "iife",
    platform: "browser",
    // The stylesheet references the codicon font; esbuild copies it to dist/codicon.ttf and
    // rewrites the url so the webview's font-src (its own resources) covers it.
    loader: { ".ttf": "file" },
    assetNames: "[name]",
  };
}

/** @returns {import("esbuild").BuildOptions} */
export function elkWorkerOptions(production) {
  return {
    ...commonOptions(production),
    entryPoints: ["webview/layout/elkWorker.ts"],
    outfile: "dist/elkWorker.js",
    format: "iife",
    platform: "browser",
  };
}

/** Integration tests run inside VS Code via @vscode/test-cli; bundle each to cjs. */
export function integrationOptions(production) {
  const entries = existsSync("test/integration")
    ? readdirSync("test/integration")
        .filter((f) => f.endsWith(".test.ts"))
        .map((f) => join("test/integration", f))
    : [];
  if (entries.length === 0) return undefined;
  return {
    ...commonOptions(production),
    entryPoints: entries,
    outdir: "dist/test/integration",
    entryNames: "[name]",
    format: "cjs",
    platform: "node",
    external: ["vscode", "mocha"],
  };
}

export function copyAssets() {
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
