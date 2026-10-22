// Types for esbuild.config.mjs so test/unit/bundle.test.ts can import it under strict mode.
import type { BuildOptions, Plugin } from "esbuild";

export const ROOT: string;
export const treeSitterCjsPlugin: Plugin;
export function commonOptions(production: boolean): BuildOptions;
export function extensionOptions(production: boolean): BuildOptions;
export function yosysWorkerOptions(production: boolean): BuildOptions;
export function webviewOptions(production: boolean): BuildOptions;
export function elkWorkerOptions(production: boolean): BuildOptions;
export function integrationOptions(production: boolean): BuildOptions | undefined;
export function copyAssets(): void;
