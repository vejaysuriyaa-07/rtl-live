// Glue between VS Code documents, the scheduler, the parsers and the webview.
import * as vscode from "vscode";
import type { SchematicDoc } from "../ir/types";
import { createStructuralParser, type StructuralParser } from "../structural";
import { structuralToIr } from "../structural/toIr";
import { selectTop } from "../structural/topSelect";
import type { BannerError, StatusInfo, ThemeKind } from "../shared/protocol";
import { log } from "./log";
import { Scheduler, type StructuralJob, type SynthJob } from "./scheduler";
import type { SchematicViewProvider } from "./schematicView";

export interface RenderEvent {
  generation: number;
  doc: SchematicDoc;
}

export function isVerilogDocument(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== "file" && doc.uri.scheme !== "untitled") return false;
  if (doc.languageId === "verilog" || doc.languageId === "systemverilog") return true;
  return /\.(v|vh|sv|svh)$/i.test(doc.fileName);
}

function settings(): { structuralDebounceMs: number; synthDebounceMs: number } {
  const c = vscode.workspace.getConfiguration("rtlLive");
  return {
    structuralDebounceMs: Math.max(0, c.get<number>("structuralDebounceMs", 60)),
    synthDebounceMs: Math.max(0, c.get<number>("synthDebounceMs", 300)),
  };
}

export class Controller implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly scheduler: Scheduler;
  private parser: StructuralParser | undefined;
  private parserPromise: Promise<StructuralParser>;
  private activeDoc: vscode.TextDocument | undefined;
  private readonly topOverride = new Map<string, string>();
  private readonly renderEmitter = new vscode.EventEmitter<RenderEvent>();
  readonly onDidRender = this.renderEmitter.event;
  private lastRender: RenderEvent | undefined;
  private status: StatusInfo = { fidelity: "structural", backend: "none" };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: SchematicViewProvider,
  ) {
    this.scheduler = new Scheduler(settings(), {
      runStructural: (job) => this.runStructural(job),
      runSynth: (job) => this.runSynth(job),
    });
    const distDir = vscode.Uri.joinPath(context.extensionUri, "dist").fsPath;
    this.parserPromise = createStructuralParser(
      { runtimeDir: distDir, grammarPath: `${distDir}/tree-sitter-verilog.wasm` },
      (reason) => log.warn(`tree-sitter grammar unavailable (${reason}); using fallback scanner`),
    ).then((p) => {
      this.parser = p;
      log.info(`structural parser: ${p.name}`);
      // Re-run for the active document now that the parser is ready.
      if (this.activeDoc) this.scheduler.textChanged(this.key(this.activeDoc), this.activeDoc.getText(), { immediate: true, synth: false });
      return p;
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((ed) => this.setActive(ed?.document)),
      vscode.workspace.onDidChangeTextDocument((ev) => {
        if (this.activeDoc && ev.document === this.activeDoc) {
          this.scheduler.textChanged(this.key(ev.document), ev.document.getText(), { synth: false });
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc === this.activeDoc) this.setActive(undefined);
      }),
      vscode.window.onDidChangeTextEditorSelection((ev) => {
        if (this.activeDoc && ev.textEditor.document === this.activeDoc) {
          const pos = ev.selections[0]?.active;
          if (pos) this.provider.post({ type: "cursor", generation: this.scheduler.currentGeneration(this.key(this.activeDoc)), cursor: { line: pos.line + 1, column: pos.character + 1 } });
        }
      }),
      vscode.workspace.onDidChangeConfiguration((ev) => {
        if (ev.affectsConfiguration("rtlLive")) {
          this.scheduler.updateOptions(settings());
          log.info("settings updated");
          if (this.activeDoc) this.scheduler.textChanged(this.key(this.activeDoc), this.activeDoc.getText(), { immediate: true, synth: false });
        }
      }),
      vscode.window.onDidChangeActiveColorTheme((t) => this.provider.post({ type: "theme", generation: 0, theme: themeKind(t.kind) })),
      provider.onDidBecomeReady(() => {
        this.provider.post({ type: "theme", generation: 0, theme: themeKind(vscode.window.activeColorTheme.kind) });
        this.provider.post({ type: "status", generation: 0, status: this.status });
        if (this.activeDoc) this.scheduler.textChanged(this.key(this.activeDoc), this.activeDoc.getText(), { immediate: true, synth: false });
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
              this.scheduler.textChanged(this.key(this.activeDoc), this.activeDoc.getText(), { immediate: true, synth: false });
            }
            break;
          case "openInPanel":
            this.provider.openInPanel();
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

  get currentDocument(): vscode.TextDocument | undefined {
    return this.activeDoc;
  }

  get lastRenderEvent(): RenderEvent | undefined {
    return this.lastRender;
  }

  get parserName(): string | undefined {
    return this.parser?.name;
  }

  whenParserReady(): Promise<StructuralParser> {
    return this.parserPromise;
  }

  private setActive(doc: vscode.TextDocument | undefined): void {
    if (doc && !isVerilogDocument(doc)) {
      // Keep showing the last Verilog document when switching to e.g. the output panel.
      return;
    }
    this.activeDoc = doc;
    if (doc) this.scheduler.textChanged(this.key(doc), doc.getText(), { immediate: true, synth: false });
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
      this.scheduler.textChanged(this.key(this.activeDoc), this.activeDoc.getText(), { immediate: true, synth: false });
    }
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
      const first = file.errors[0];
      const error: BannerError | null = first ? { line: first.line, column: first.column, message: first.message, file: baseName(doc.fileName) } : null;
      this.provider.post({ type: "render", generation: job.generation, doc: ir, fitOnRender: false });
      this.provider.post({ type: "error", generation: job.generation, error });
      this.status = { ...this.status, fidelity: "structural", message: `${file.modules.length} module${file.modules.length === 1 ? "" : "s"}` };
      this.provider.post({ type: "status", generation: job.generation, status: this.status });
      this.lastRender = { generation: job.generation, doc: ir };
      this.renderEmitter.fire(this.lastRender);
      if (t1 - t0 > 100) log.warn(`structural pass took ${(t1 - t0).toFixed(1)} ms`);
    } catch (e) {
      log.error("structural pass failed", e);
    }
  }

  private runSynth(job: SynthJob): Promise<void> {
    void job;
    return Promise.resolve();
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
