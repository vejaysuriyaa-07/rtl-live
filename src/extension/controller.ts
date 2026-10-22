// Glue between VS Code documents, the scheduler, the parsers, synthesis and the webview.
import * as vscode from "vscode";
import type { SchematicDoc } from "../ir/types";
import { createStructuralParser, type StructuralParser } from "../structural";
import { overlayStructural, overlaySummaryText } from "../ir/overlay";
import { structuralToIr } from "../structural/toIr";
import { selectTop } from "../structural/topSelect";
import type { StructuralFile } from "../structural/types";
import type { BannerError, StatusInfo, ThemeKind } from "../shared/protocol";
import { log } from "./log";
import { Scheduler, type StructuralJob, type SynthJob } from "./scheduler";
import type { SchematicViewProvider } from "./schematicView";
import { readSynthSettings, SynthManager } from "./synthManager";
import { findVerilator, verilatorLint } from "./verilatorLint";
import { friendlyVerilatorMessage } from "../structural/errorMessages";

export interface RenderEvent {
  generation: number;
  doc: SchematicDoc;
}

export function isVerilogDocument(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== "file" && doc.uri.scheme !== "untitled") return false;
  if (doc.languageId === "verilog" || doc.languageId === "systemverilog") return true;
  if (doc.uri.scheme === "untitled") return false; // "Untitled-1" has no extension; the language mode decides
  return /\.(v|vh|sv|svh)$/i.test(doc.fileName);
}

/** Plain Text that is probably Verilog: a module header plus one more Verilog keyword. */
export function looksLikeVerilog(text: string): boolean {
  return /\bmodule\s+[A-Za-z_][\w$]*/.test(text) && /\b(endmodule|input|output|inout|assign|always|wire|reg|logic)\b/.test(text);
}

function schedulerSettings(): { structuralDebounceMs: number; synthDebounceMs: number } {
  const c = vscode.workspace.getConfiguration("rtlLive");
  return {
    structuralDebounceMs: Math.max(0, c.get<number>("structuralDebounceMs", 60)),
    synthDebounceMs: Math.max(0, c.get<number>("synthDebounceMs", 300)),
  };
}

interface DocState {
  /** Latest structural result */
  structural?: { generation: number; file: StructuralFile; top: string; text: string };
  /** Last successful synthesized doc for this document */
  lastGood?: SchematicDoc;
  lastGoodKey?: string;
}

export class Controller implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly scheduler: Scheduler;
  readonly synth: SynthManager;
  private parser: StructuralParser | undefined;
  private readonly parserPromise: Promise<StructuralParser>;
  private activeDoc: vscode.TextDocument | undefined;
  /** Untitled Plain Text document currently offered the "Set language to Verilog" hint */
  private hintDoc: vscode.TextDocument | undefined;
  private lintTimer: NodeJS.Timeout | undefined;
  /** Counters for tests */
  lintStats = { runs: 0, replaced: 0 };
  private readonly topOverride = new Map<string, string>();
  private readonly docs = new Map<string, DocState>();
  private readonly renderEmitter = new vscode.EventEmitter<RenderEvent>();
  readonly onDidRender = this.renderEmitter.event;
  private lastRender: RenderEvent | undefined;
  private status: StatusInfo = { fidelity: "structural", backend: "none" };
  stats = { structuralRuns: 0, synthRuns: 0, synthResults: 0 };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: SchematicViewProvider,
  ) {
    const distDir = vscode.Uri.joinPath(context.extensionUri, "dist").fsPath;
    this.synth = new SynthManager(`${distDir}/yosysWorker.mjs`);
    this.scheduler = new Scheduler(schedulerSettings(), {
      runStructural: (job) => this.runStructural(job),
      runSynth: (job) => this.runSynth(job),
    });
    this.parserPromise = createStructuralParser(
      { runtimeDir: distDir, grammarPath: `${distDir}/tree-sitter-verilog.wasm` },
      (reason) => log.warn(`tree-sitter grammar unavailable (${reason}); using fallback scanner`),
    ).then((p) => {
      this.parser = p;
      log.info(`structural parser: ${p.name}`);
      this.rerunActive();
      return p;
    });
    // Warm the synthesis engine in the background.
    this.synth.onDidChangeState(() => {
      this.postStatus();
      if (this.synth.backendName !== "none" && !this.synth.warmingUp) this.rerunActive();
    });
    void this.synth.ensureBackend();

    this.disposables.push(
      this.synth,
      vscode.window.onDidChangeActiveTextEditor((ed) => this.setActive(ed?.document)),
      vscode.workspace.onDidChangeTextDocument((ev) => {
        if (this.activeDoc && ev.document === this.activeDoc) {
          this.scheduler.textChanged(this.key(ev.document), ev.document.getText(), { synth: false });
        } else if (ev.document === vscode.window.activeTextEditor?.document) {
          this.updateHint(ev.document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc === this.activeDoc) this.setActive(undefined);
        this.docs.delete(this.key(doc));
      }),
      vscode.window.onDidChangeTextEditorSelection((ev) => {
        if (this.activeDoc && ev.textEditor.document === this.activeDoc) {
          const pos = ev.selections[0]?.active;
          if (pos) this.provider.post({ type: "cursor", generation: this.scheduler.currentGeneration(this.key(this.activeDoc)), cursor: { line: pos.line + 1, column: pos.character + 1 } });
        }
      }),
      vscode.workspace.onDidChangeConfiguration((ev) => {
        if (ev.affectsConfiguration("rtlLive")) {
          this.scheduler.updateOptions(schedulerSettings());
          this.synth.applySettings(readSynthSettings());
          log.info("settings updated");
          this.rerunActive();
        }
      }),
      vscode.window.onDidChangeActiveColorTheme((t) => this.provider.post({ type: "theme", generation: 0, theme: themeKind(t.kind) })),
      provider.onDidBecomeReady(() => {
        this.provider.post({ type: "theme", generation: 0, theme: themeKind(vscode.window.activeColorTheme.kind) });
        this.postStatus();
        this.rerunActive();
      }),
      // After sleep or a long time in the background the editor and the view can drift apart:
      // pick the active editor up again whenever the window or the view comes back.
      provider.onDidChangeVisibility((visible) => {
        if (visible) this.followActiveEditor("view shown");
      }),
      vscode.window.onDidChangeWindowState((ws) => {
        if (ws.focused) {
          this.provider.resync("window focus");
          this.followActiveEditor("window focus");
        }
      }),
      provider.onMessage((msg) => {
        switch (msg.type) {
          case "revealSource":
            void this.reveal(msg.line, msg.column, msg.endLine ?? msg.line, msg.endColumn ?? msg.column);
            break;
          case "revealError":
            void this.reveal(msg.line, msg.column, msg.line, msg.column);
            break;
          case "selectTop":
            if (this.activeDoc) {
              this.topOverride.set(this.key(this.activeDoc), msg.top);
              this.rerunActive();
            }
            break;
          case "openInPanel":
            this.provider.openInPanel();
            break;
          case "setLanguage":
            void this.setLanguage(msg.language);
            break;
          case "export":
            void this.saveExport(msg.format, msg.data);
            break;
          default:
            break;
        }
      }),
    );
    this.setActive(vscode.window.activeTextEditor?.document);
  }

  private key(doc: vscode.TextDocument): string {
    return doc.uri.toString();
  }

  private state(key: string): DocState {
    let s = this.docs.get(key);
    if (!s) {
      s = {};
      this.docs.set(key, s);
    }
    return s;
  }

  get currentDocument(): vscode.TextDocument | undefined {
    return this.activeDoc;
  }

  get lastRenderEvent(): RenderEvent | undefined {
    return this.lastRender;
  }

  get parserName(): string | undefined {
    return this.parser?.name;
  }

  get currentStatus(): StatusInfo {
    return this.status;
  }

  whenParserReady(): Promise<StructuralParser> {
    return this.parserPromise;
  }

  /** Re-read the active editor and rerun; used after focus and visibility changes. */
  followActiveEditor(reason: string): void {
    const doc = vscode.window.activeTextEditor?.document;
    if (doc && isVerilogDocument(doc) && doc !== this.activeDoc) {
      log.info(`following active editor after ${reason}: ${baseName(doc.fileName)}`);
      this.setActive(doc);
      return;
    }
    this.rerunActive();
  }

  private rerunActive(): void {
    if (this.activeDoc) this.scheduler.textChanged(this.key(this.activeDoc), this.activeDoc.getText(), { immediate: true, synth: false });
  }

  private setActive(doc: vscode.TextDocument | undefined): void {
    if (doc && !isVerilogDocument(doc)) {
      this.updateHint(doc);
      return; // keep showing the last Verilog document
    }
    this.updateHint(undefined);
    this.activeDoc = doc;
    if (doc) this.scheduler.textChanged(this.key(doc), doc.getText(), { immediate: true, synth: false });
  }

  /** Offer "Set language to Verilog" for an untitled Plain Text document that looks like Verilog (bug 9). */
  private updateHint(doc: vscode.TextDocument | undefined): void {
    const offer = doc !== undefined && doc.uri.scheme === "untitled" && doc.languageId === "plaintext" && looksLikeVerilog(doc.getText());
    const next = offer ? doc : undefined;
    if (next === this.hintDoc) return;
    this.hintDoc = next;
    this.provider.post({
      type: "hint",
      generation: 0,
      hint: next ? { message: `${next.fileName.replace(/^.*[\\/]/, "")} is Plain Text but looks like Verilog.`, action: { label: "Set language to Verilog", command: "setLanguage" } } : null,
    });
  }

  get currentHintDocument(): vscode.TextDocument | undefined {
    return this.hintDoc;
  }

  private async setLanguage(language: "verilog" | "systemverilog"): Promise<void> {
    const doc = this.hintDoc;
    if (!doc) return;
    try {
      const changed = await vscode.languages.setTextDocumentLanguage(doc, language);
      log.info(`language of ${changed.fileName} set to ${language}`);
      this.updateHint(undefined);
      this.setActive(changed);
    } catch (e) {
      log.error("could not change the document language", e);
    }
  }

  async selectTopInteractively(): Promise<void> {
    const names = this.lastRender?.doc.moduleNames ?? [];
    if (names.length === 0) {
      void vscode.window.showInformationMessage("RTL Live: no modules parsed yet.");
      return;
    }
    const pick = await vscode.window.showQuickPick(names, { placeHolder: "Top module" });
    if (pick && this.activeDoc) {
      this.topOverride.set(this.key(this.activeDoc), pick);
      this.rerunActive();
    }
  }

  private postStatus(patch?: Partial<StatusInfo>): void {
    const gen = this.activeDoc ? this.scheduler.currentGeneration(this.key(this.activeDoc)) : 0;
    this.status = {
      ...this.status,
      ...patch,
      backend: this.synth.backendName,
      ...(this.synth.version !== undefined ? { backendVersion: this.synth.version } : {}),
      warmingUp: this.synth.warmingUp,
    };
    this.provider.post({ type: "status", generation: gen, status: this.status });
  }

  private postRender(generation: number, doc: SchematicDoc): void {
    this.provider.post({ type: "render", generation, doc, fitOnRender: false });
    this.lastRender = { generation, doc };
    this.renderEmitter.fire(this.lastRender);
  }

  private runStructural(job: StructuralJob): void {
    const parser = this.parser;
    if (!parser) return; // parserPromise re-runs once ready
    const doc = this.activeDoc;
    if (!doc || this.key(doc) !== job.docKey) return;
    try {
      const t0 = performance.now();
      const file = parser.parse(job.text);
      const cursorLine = vscode.window.activeTextEditor?.document === doc ? (vscode.window.activeTextEditor?.selection.active.line ?? 0) + 1 : undefined;
      const top = selectTop({ modules: file.modules, override: this.topOverride.get(job.docKey), cursorLine });
      const ir = structuralToIr(file, { sourceUri: doc.uri.toString(), generation: job.generation, top });
      const t1 = performance.now();
      if (this.scheduler.currentGeneration(job.docKey) !== job.generation) return;
      this.stats.structuralRuns++;
      const st = this.state(job.docKey);
      st.structural = { generation: job.generation, file, top, text: job.text };
      const first = file.errors[0];
      const error: BannerError | null = first ? { line: first.line, column: first.column, message: first.message, file: baseName(doc.fileName) } : null;
      if (error) this.scheduleLint(job, top, error);
      else this.cancelLint();
      const synthOn = this.synth.backendName !== "off";
      const keepLastGood = synthOn && st.lastGood !== undefined && st.lastGood.top === top && (top === "" || st.lastGood.modules[top] !== undefined);
      const modCount = `${file.modules.length} module${file.modules.length === 1 ? "" : "s"}`;
      if (keepLastGood) {
        // Stale rule (bug 2): keep the last synthesized diagram, overlay the ports that changed in
        // the newer text, and say so in the badge text. The render and the badge move together.
        const overlay = overlayStructural(st.lastGood!, ir, job.generation);
        const changes = overlaySummaryText(overlay.summary);
        this.postRender(job.generation, overlay.doc);
        this.provider.post({ type: "error", generation: job.generation, error });
        const base = file.hasErrors ? "last good diagram, fix the error to resynthesize" : synthOn ? "last good diagram, synthesizing" : modCount;
        this.postStatus({ fidelity: "stale", message: changes ? `${base}; ${changes}` : base });
        if (!file.hasErrors) this.scheduler.requestSynth(job.docKey, job.generation, job.text);
      } else {
        this.postRender(job.generation, ir);
        this.provider.post({ type: "error", generation: job.generation, error });
        this.postStatus({ fidelity: "structural", message: file.hasErrors ? modCount : synthOn && top !== "" ? "synthesizing" : modCount });
        if (!file.hasErrors && synthOn && top !== "") this.scheduler.requestSynth(job.docKey, job.generation, job.text);
      }
      if (t1 - t0 > 100) log.warn(`structural pass took ${(t1 - t0).toFixed(1)} ms`);
    } catch (e) {
      log.error("structural pass failed", e);
    }
  }

  private cancelLint(): void {
    if (this.lintTimer) clearTimeout(this.lintTimer);
    this.lintTimer = undefined;
  }

  /**
   * Bug 3: when the text does not parse, ask Verilator (if installed and enabled) for its
   * verdict a moment later and replace a generic structural message with the specific one.
   */
  private scheduleLint(job: StructuralJob, top: string, current: BannerError): void {
    this.cancelLint();
    if (!this.synth.currentSettings.lintWithVerilator) return;
    const binary = findVerilator();
    if (!binary) return;
    this.lintTimer = setTimeout(() => {
      this.lintTimer = undefined;
      if (this.scheduler.currentGeneration(job.docKey) !== job.generation) return;
      this.lintStats.runs++;
      void verilatorLint(binary, job.text, "", top)
        .then((lint) => {
          if (!lint || lint.line === undefined || this.scheduler.currentGeneration(job.docKey) !== job.generation) return;
          const message = friendlyVerilatorMessage(lint.message);
          const generic = /^syntax error/.test(current.message);
          if (!generic) {
            log.info(`verilator: ${message} at ${lint.line}:${lint.column ?? 1} (keeping "${current.message}")`);
            return;
          }
          this.lintStats.replaced++;
          this.provider.post({ type: "error", generation: job.generation, error: { ...current, message, line: lint.line, ...(lint.column !== undefined ? { column: lint.column } : {}) } });
        })
        .catch((e: unknown) => log.warn(`verilator lint failed: ${e instanceof Error ? e.message : String(e)}`));
    }, 400);
  }

  private async runSynth(job: SynthJob): Promise<void> {
    const st = this.docs.get(job.docKey);
    const structural = st?.structural;
    if (!st || !structural || structural.generation !== job.generation || structural.file.hasErrors || structural.top === "") return;
    const doc = this.activeDoc;
    if (!doc || this.key(doc) !== job.docKey) return;
    const key = this.synth.cacheKey(job.text, structural.top);
    const cached = this.synth.cache.get(key);
    const sourceUri = doc.uri.toString();
    if (cached) {
      this.synth.stats.cacheHits++;
      const out: SchematicDoc = { ...cached.doc, generation: job.generation, sourceUri, moduleNames: structural.file.modules.map((m) => m.name) };
      st.lastGood = out;
      st.lastGoodKey = key;
      this.postRender(job.generation, out);
      this.provider.post({ type: "error", generation: job.generation, error: null });
      this.postStatus({ fidelity: "synthesized", message: "cached" });
      return;
    }
    this.stats.synthRuns++;
    try {
      const res = await this.synth.run({ text: job.text, file: structural.file, top: structural.top, sourceUri, generation: job.generation, signal: job.signal });
      if (!res || res.cancelled || job.signal.aborted) return;
      if (this.scheduler.currentGeneration(job.docKey) !== job.generation) return; // stale result
      this.stats.synthResults++;
      if (res.ok && res.doc) {
        if (res.doc.modules[structural.top] && res.doc.modules[structural.top]!.nodes.length > 2000) {
          log.warn(`synthesized netlist has ${res.doc.modules[structural.top]!.nodes.length} nodes; showing the structural view`);
          this.postStatus({ fidelity: "structural", message: "netlist too large for the gate view (over 2,000 nodes)" });
          return;
        }
        this.synth.cache.set(key, { doc: res.doc, unknownCellTypes: res.unknownCellTypes });
        st.lastGood = res.doc;
        st.lastGoodKey = key;
        this.postRender(job.generation, res.doc);
        this.provider.post({ type: "error", generation: job.generation, error: null });
        this.postStatus({ fidelity: "synthesized", message: `${res.elapsedMs.toFixed(0)} ms` });
        for (const d of res.diagnostics) log.warn(`synth: ${d.message}`);
      } else {
        let err: BannerError = { message: res.error?.message ?? "synthesis failed", ...(res.error?.line !== undefined ? { line: res.error.line } : {}), ...(res.error?.column !== undefined ? { column: res.error.column } : {}), file: baseName(doc.fileName) };
        if (this.synth.currentSettings.lintWithVerilator) {
          const v = findVerilator();
          if (v) {
            const lint = await verilatorLint(v, job.text, res.stubs, structural.top).catch(() => undefined);
            if (lint && this.scheduler.currentGeneration(job.docKey) === job.generation) {
              err = { ...err, message: lint.message, ...(lint.line !== undefined ? { line: lint.line } : {}), ...(lint.column !== undefined ? { column: lint.column } : {}) };
            }
          }
        }
        log.warn(`synthesis failed: ${err.message}${res.stderr ? `\n${res.stderr.trim()}` : ""}`);
        this.provider.post({ type: "error", generation: job.generation, error: err });
        this.postStatus({ fidelity: st.lastGood ? "stale" : "structural", message: res.timedOut ? "synthesis timed out" : "synthesis failed" });
      }
    } catch (e) {
      log.error("synthesis crashed", e);
    }
  }

  private async reveal(line: number, column: number, endLine: number, endColumn: number): Promise<void> {
    const doc = this.activeDoc;
    if (!doc) return;
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc) ?? (await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false }));
    const start = new vscode.Position(Math.max(0, line - 1), Math.max(0, column - 1));
    const end = new vscode.Position(Math.max(0, endLine - 1), Math.max(0, endColumn - 1));
    editor.selection = new vscode.Selection(start, end);
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private async saveExport(format: "svg" | "png", data: string): Promise<void> {
    const base = this.activeDoc ? baseName(this.activeDoc.fileName).replace(/\.[^.]+$/, "") : "schematic";
    const folder = this.activeDoc && this.activeDoc.uri.scheme === "file" ? vscode.Uri.joinPath(this.activeDoc.uri, "..") : (vscode.workspace.workspaceFolders?.[0]?.uri ?? this.context.globalStorageUri);
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(folder, `${base}.${format}`),
      filters: format === "svg" ? { SVG: ["svg"] } : { PNG: ["png"] },
    });
    if (!target) return;
    const bytes = format === "svg" ? Buffer.from(data, "utf8") : Buffer.from(data, "base64");
    await vscode.workspace.fs.writeFile(target, bytes);
    log.info(`exported ${format} to ${target.fsPath}`);
  }

  dispose(): void {
    this.cancelLint();
    this.scheduler.dispose();
    this.renderEmitter.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function themeKind(kind: vscode.ColorThemeKind): ThemeKind {
  switch (kind) {
    case vscode.ColorThemeKind.Light:
      return "light";
    case vscode.ColorThemeKind.HighContrast:
      return "highContrast";
    case vscode.ColorThemeKind.HighContrastLight:
      return "highContrastLight";
    default:
      return "dark";
  }
}
