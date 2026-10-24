// Picks and owns the synthesis backend according to settings; preloads the wasm
// engine in the background; tracks backend feature flags and the result cache.
import * as vscode from "vscode";
import type { SchematicDoc } from "../ir/types";
import type { SimplifyOptions } from "../ir/simplify";
import type { SynthBackend } from "../synth/backend";
import { NativeYosysBackend } from "../synth/nativeBackend";
import { describeLookup, fallbackMessage, locateTool, realLookupEnv, realProbe, type LookupResult, type ToolName } from "../synth/toolLookup";
import { WasmYosysBackend } from "../synth/wasmBackend";
import { DEFAULT_FEATURES, synthesize, type BackendFeatures, type SynthesizeResult } from "../synth/synthesize";
import type { StructuralFile } from "../structural/types";
import type { SynthView } from "../synth/script";
import { LruCache, sha256 } from "./cache";
import { log, logOnce } from "./log";

export type BackendSetting = "auto" | "native" | "wasm" | "off";

export interface SynthSettings {
  backend: BackendSetting;
  yosysPath: string;
  verilatorPath: string;
  extraPasses: string;
  optimize: boolean;
  bubbles: boolean;
  lintWithVerilator: boolean;
}

export function readSynthSettings(): SynthSettings {
  const c = vscode.workspace.getConfiguration("rtlLive");
  return {
    backend: c.get<BackendSetting>("synthesisBackend", "auto"),
    yosysPath: c.get<string>("yosysPath", ""),
    verilatorPath: c.get<string>("verilatorPath", ""),
    extraPasses: c.get<string>("yosysExtraPasses", ""),
    optimize: c.get<boolean>("optimize", false),
    bubbles: c.get<boolean>("bubbles", true),
    lintWithVerilator: c.get<boolean>("lintWithVerilator", true),
  };
}

export interface CachedSynth {
  doc: SchematicDoc;
  unknownCellTypes: string[];
}

export const SYNTH_TIMEOUT_MS = 10_000;

export class SynthManager implements vscode.Disposable {
  private backend: SynthBackend | undefined;
  private backendPromise: Promise<SynthBackend | undefined> | undefined;
  private settings: SynthSettings;
  private features: BackendFeatures = { ...DEFAULT_FEATURES };
  readonly cache = new LruCache<CachedSynth>(32);
  private readonly stateEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.stateEmitter.event;
  warmingUp = false;
  version: string | undefined;
  /** Where the native engine runs from; undefined for the built-in engine */
  backendPath: string | undefined;
  stats = { runs: 0, cacheHits: 0, failures: 0 };
  /** Last lookup result per tool, for the badge tooltip and the "Show tool paths" command */
  readonly lookups: Partial<Record<ToolName, LookupResult>> = {};
  private verilatorPromise: Promise<string | undefined> | undefined;
  private fallbackNoticeShown = false;

  constructor(private readonly workerPath: string) {
    this.settings = readSynthSettings();
    void this.locateVerilator();
  }

  /** Verified verilator path, or undefined; resolved once per settings change. */
  locateVerilator(): Promise<string | undefined> {
    this.verilatorPromise ??= locateTool("verilator", this.settings.verilatorPath, realLookupEnv(), realProbe).then((r) => {
      this.lookups.verilator = r;
      for (const line of describeLookup("verilator", r)) log.info(line);
      return r.found?.path;
    });
    return this.verilatorPromise;
  }

  /** The verilator path when the lookup has finished and found one. */
  get verilatorPath(): string | undefined {
    return this.lookups.verilator?.found?.path;
  }

  /** One line per tool plus the engine in use, for the "Show tool paths" command. */
  toolReport(): string[] {
    const lines: string[] = [];
    for (const tool of ["yosys", "verilator"] as const) {
      const r = this.lookups[tool];
      if (r) lines.push(...describeLookup(tool, r));
      else lines.push(`${tool}: not looked up yet`);
    }
    const engine = this.backendName === "native" ? `native yosys ${this.version ?? ""} at ${this.backendPath ?? "?"}` : this.backendName === "wasm" ? `built-in wasm yosys ${this.version ?? ""}` : this.backendName === "off" ? "off (rtlLive.synthesisBackend)" : "not started";
    lines.push(`synthesis engine: ${engine.replace(/\s+at/, " at").replace(/  +/g, " ")}`);
    lines.push(`platform: ${process.platform} ${process.arch}, PATH has ${(process.env["PATH"] ?? process.env["Path"] ?? "").split(process.platform === "win32" ? ";" : ":").filter((d) => d !== "").length} folders`);
    return lines;
  }

  get currentSettings(): SynthSettings {
    return this.settings;
  }

  get backendName(): "native" | "wasm" | "off" | "none" {
    if (this.settings.backend === "off") return "off";
    return this.backend?.name ?? "none";
  }

  /** Key fragment so cache entries are invalidated by settings changes. */
  private settingsKey(): string {
    const s = this.settings;
    return `${this.backendName}|${s.extraPasses}|${s.optimize ? 1 : 0}|${s.bubbles ? 1 : 0}|${this.features.procNorom ? 1 : 0}`;
  }

  applySettings(next: SynthSettings): void {
    const backendChanged = next.backend !== this.settings.backend || next.yosysPath !== this.settings.yosysPath;
    const verilatorChanged = next.verilatorPath !== this.settings.verilatorPath;
    this.settings = next;
    if (verilatorChanged) {
      this.verilatorPromise = undefined;
      void this.locateVerilator();
    }
    if (backendChanged) {
      this.backend?.dispose();
      this.backend = undefined;
      this.backendPromise = undefined;
      this.version = undefined;
      this.backendPath = undefined;
      this.cache.clear();
      void this.ensureBackend();
    }
    this.stateEmitter.fire();
  }

  /** Resolve (and preload) the backend; safe to call many times. */
  ensureBackend(): Promise<SynthBackend | undefined> {
    if (this.settings.backend === "off") return Promise.resolve(undefined);
    this.backendPromise ??= this.createBackend().then((b) => {
      this.backend = b;
      this.stateEmitter.fire();
      return b;
    });
    return this.backendPromise;
  }

  private async createBackend(): Promise<SynthBackend | undefined> {
    const s = this.settings;
    if (s.backend === "native" || s.backend === "auto") {
      // Every candidate is verified with -V (3 s) before use, so a broken binary is skipped.
      const r = await locateTool("yosys", s.yosysPath, realLookupEnv(), realProbe);
      this.lookups.yosys = r;
      for (const line of describeLookup("yosys", r)) log.info(line);
      if (r.found) {
        const native = new NativeYosysBackend(r.found.path, (m) => log.info(m));
        this.version = r.found.version;
        this.backendPath = r.found.path;
        log.info(`synthesis backend: native yosys ${this.version ?? "?"} at ${r.found.path}`);
        return native;
      }
      const notice = fallbackMessage(s.backend, r);
      log.warn(`no usable native yosys (${s.backend === "native" ? "rtlLive.synthesisBackend is native" : "auto"}); falling back to the built-in engine`);
      if (notice && !this.fallbackNoticeShown) {
        this.fallbackNoticeShown = true;
        void vscode.window.showInformationMessage(`RTL Live: ${notice}`, "Show tool paths").then((pick) => {
          if (pick) void vscode.commands.executeCommand("rtlLive.showToolPaths");
        });
      }
    }
    this.backendPath = undefined;
    const wasm = new WasmYosysBackend({ workerPath: this.workerPath, log: (m) => log.info(m) });
    this.warmingUp = true;
    this.stateEmitter.fire();
    const t0 = performance.now();
    try {
      await wasm.preload();
      this.version = await wasm.version();
      log.info(`synthesis backend: wasm yosys ${this.version ?? "?"} (cold start ${(performance.now() - t0).toFixed(0)} ms)`);
    } catch (e) {
      log.error("wasm yosys failed to start", e);
      wasm.dispose();
      this.warmingUp = false;
      this.stateEmitter.fire();
      return undefined;
    }
    this.warmingUp = false;
    return wasm;
  }

  simplifyOptions(): SimplifyOptions {
    return { mergeChains: true, dropBuffers: true, bubbles: this.settings.bubbles };
  }

  cacheKey(text: string, top: string, view: SynthView): string {
    return sha256(text, top, view, this.settingsKey());
  }

  async run(args: { view: SynthView; text: string; file: StructuralFile; top: string; sourceUri: string; generation: number; signal: AbortSignal }): Promise<SynthesizeResult | undefined> {
    const backend = await this.ensureBackend();
    if (!backend || args.signal.aborted) return undefined;
    this.stats.runs++;
    let res = await synthesize(backend, { ...args, optimize: this.settings.optimize, extraPasses: this.settings.extraPasses || undefined, simplify: this.simplifyOptions(), timeoutMs: SYNTH_TIMEOUT_MS }, this.features);
    // Older yosys: retry without unsupported flags once, then remember.
    if (!res.ok && !res.cancelled && /norom|noscopeinfo|unknown option|Unknown option|does not support/i.test(res.stderr)) {
      const before = { ...this.features };
      if (/norom/i.test(res.stderr)) this.features.procNorom = false;
      if (/noscopeinfo/i.test(res.stderr)) this.features.noScopeInfo = false;
      if (before.procNorom !== this.features.procNorom || before.noScopeInfo !== this.features.noScopeInfo) {
        log.warn(`backend lacks a flag; retrying with procNorom=${this.features.procNorom} noScopeInfo=${this.features.noScopeInfo}`);
        res = await synthesize(backend, { ...args, optimize: this.settings.optimize, extraPasses: this.settings.extraPasses || undefined, simplify: this.simplifyOptions(), timeoutMs: SYNTH_TIMEOUT_MS }, this.features);
      }
    }
    if (res.ok) {
      for (const t of res.unknownCellTypes) logOnce(`cell:${t}`, `unknown yosys cell type ${t} drawn as a generic box`);
    } else if (!res.cancelled) {
      this.stats.failures++;
    }
    return res;
  }

  dispose(): void {
    this.backend?.dispose();
    this.backend = undefined;
    this.stateEmitter.dispose();
  }
}
