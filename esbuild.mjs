// Builds all bundles (see esbuild.config.mjs for the list and the options)
// and copies wasm assets into dist/ so the packaged vsix needs no node_modules.
import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import {
  copyAssets,
  elkWorkerOptions,
  extensionOptions,
  integrationOptions,
  webviewOptions,
  yosysWorkerOptions,
} from "./esbuild.config.mjs";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

mkdirSync("dist", { recursive: true });

const configs = [extensionOptions(production), yosysWorkerOptions(production), webviewOptions(production), elkWorkerOptions(production), integrationOptions(production)].filter(
  (c) => c !== undefined,
);

if (watch) {
  copyAssets();
  const ctxs = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("[esbuild] watching");
} else {
  copyAssets();
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
