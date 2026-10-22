// Picks and owns the synthesis backend according to settings; preloads the wasm
// engine in the background; tracks backend feature flags and the result cache.
import * as vscode from "vscode";
import type { SchematicDoc } from "../ir/types";
import type { SimplifyOptions } from "../ir/simplify";
import type { SynthBackend } from "../synth/backend";
import { findYosys, NativeYosysBackend } from "../synth/nativeBackend";
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
  stats = { runs: 0, cacheHits: 0, failures: 0 };

  constructor(private readonly workerPath: string) {
    this.settings = readSynthSettings();
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
    this.settings = next;
    if (backendChanged) {
      this.backend?.dispose();
      this.backend = undefined;
      this.backendPromise = undefined;
      this.version = undefined;
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
      const bin = findYosys(s.yosysPath);
      if (bin) {
        const native = new NativeYosysBackend(bin, (m) => log.info(m));
        const v = await native.version();
        if (v !== undefined) {
          this.version = v;
          log.info(`synthesis backend: native yosys ${v} at ${bin}`);
          return native;
        }
        log.warn(`native yosys at ${bin} did not answer -V`);
      } else if (s.backend === "native") {
        log.warn("rtlLive.synthesisBackend is native but no yosys binary was found; falling back to wasm");
      }
    }
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
