// One synthesis run: structural file + text -> stubs + script -> backend -> JSON -> IR -> simplify.
import type { SchematicDoc, Diagnostic } from "../ir/types";
import { fromYosys } from "../ir/fromYosys";
import { simplifyModule, type SimplifyOptions } from "../ir/simplify";
import { annotateStateRegisters } from "../ir/fsmInfo";
import type { StructuralFile } from "../structural/types";
import type { SynthBackend } from "./backend";
import { collectStubs, stubsToVerilog } from "./blackboxStubs";
import { BLACKBOX_FILE, INPUT_FILE, OUTPUT_FILE, SCRIPT_FILE, buildScript, type ScriptOptions } from "./script";
import { isYosysDesign, type YosysDesign } from "./yosysJson";

export interface SynthesizeOptions {
  text: string;
  file: StructuralFile;
  top: string;
  sourceUri: string;
  generation: number;
  optimize: boolean;
  extraPasses?: string | undefined;
  simplify: SimplifyOptions;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface SynthesizeResult {
  ok: boolean;
  doc?: SchematicDoc;
  /** Simplified doc is `doc`; the raw one is kept for tests and golden files */
  rawDoc?: SchematicDoc;
  error?: { message: string; line?: number; column?: number };
  diagnostics: Diagnostic[];
  unknownCellTypes: string[];
  elapsedMs: number;
  cancelled?: boolean;
  timedOut?: boolean;
  stderr: string;
  script: string;
  stubs: string;
}

/** Backend feature flags discovered on first failure (proc -norom, write_json -noscopeinfo). */
export interface BackendFeatures {
  procNorom: boolean;
  noScopeInfo: boolean;
}

export const DEFAULT_FEATURES: BackendFeatures = { procNorom: true, noScopeInfo: true };

/** Pull the first "ERROR: ..." line and a line number out of yosys output. */
export function parseYosysError(text: string): { message: string; line?: number; column?: number } {
  const lines = text.split(/\r?\n/);
  const errLine = lines.find((l) => /^ERROR:/.test(l)) ?? lines.find((l) => /error/i.test(l)) ?? lines.filter((l) => l.trim()).pop() ?? "synthesis failed";
  const m = /input\.v:(\d+)(?:\.(\d+))?/.exec(errLine) ?? /line (\d+)/.exec(errLine);
  const message = errLine.replace(/^ERROR:\s*/, "").trim();
  const out: { message: string; line?: number; column?: number } = { message };
  if (m?.[1]) out.line = Number(m[1]);
  if (m?.[2]) out.column = Number(m[2]);
  return out;
}

export async function synthesize(backend: SynthBackend, opts: SynthesizeOptions, features: BackendFeatures = DEFAULT_FEATURES): Promise<SynthesizeResult> {
  const t0 = performance.now();
  const stubs = stubsToVerilog(collectStubs(opts.file, opts.top));
  const scriptOpts: ScriptOptions = {
    top: opts.top,
    hasBlackboxes: stubs !== "",
    optimize: opts.optimize,
    extraPasses: opts.extraPasses,
    procNorom: features.procNorom,
    noScopeInfo: features.noScopeInfo,
  };
  const script = buildScript(scriptOpts);
  const files: Record<string, string> = { [INPUT_FILE]: opts.text, [SCRIPT_FILE]: script };
  if (stubs !== "") files[BLACKBOX_FILE] = stubs;
  const run = await backend.run({ files, scriptFile: SCRIPT_FILE, outputFile: OUTPUT_FILE, timeoutMs: opts.timeoutMs, signal: opts.signal });
  const base = { diagnostics: [] as Diagnostic[], unknownCellTypes: [] as string[], stderr: run.stderr, script, stubs };
  if (run.cancelled) return { ...base, ok: false, cancelled: true, elapsedMs: performance.now() - t0 };
  if (run.timedOut) return { ...base, ok: false, timedOut: true, error: { message: run.stderr }, elapsedMs: performance.now() - t0 };
  if (!run.ok || run.output === undefined) {
    return { ...base, ok: false, error: parseYosysError(`${run.stderr}\n${run.stdout}`), elapsedMs: performance.now() - t0 };
  }
  let design: YosysDesign;
  try {
    const parsed: unknown = JSON.parse(run.output);
    if (!isYosysDesign(parsed)) throw new Error("not a yosys json design");
    design = parsed;
  } catch (e) {
    return { ...base, ok: false, error: { message: `could not read yosys output: ${e instanceof Error ? e.message : String(e)}` }, elapsedMs: performance.now() - t0 };
  }
  const defined = new Set(opts.file.modules.map((m) => m.name));
  const { doc: rawDoc, unknownCellTypes } = fromYosys(design, {
    top: opts.top,
    sourceUri: opts.sourceUri,
    generation: opts.generation,
    definedModules: defined,
    moduleNames: opts.file.modules.map((m) => m.name),
  });
  const modules: SchematicDoc["modules"] = {};
  for (const [name, view] of Object.entries(rawDoc.modules)) {
    const sm = opts.file.modules.find((m) => m.name === name);
    modules[name] = annotateStateRegisters(simplifyModule(view, opts.simplify), sm);
  }
  const doc: SchematicDoc = { ...rawDoc, modules };
  return { ...base, ok: true, doc, rawDoc, diagnostics: rawDoc.diagnostics, unknownCellTypes, elapsedMs: performance.now() - t0 };
}
