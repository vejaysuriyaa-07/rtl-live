import type { SchematicDoc } from "../src/ir/types";
import { isHostToWebview, type HostToWebview } from "../src/shared/protocol";
import { postToHost, vscodeApi } from "./vscodeApi";
import { initialState, currentModuleName, type ViewState } from "./state";
import { ElkRunner } from "./layout/elkRunner";
import { moduleToElk } from "./layout/toElk";
import { renderModule } from "./render/svg";
import { ZoomController } from "./interaction/zoom";
import { applyCursorHighlight, type Cursor } from "./interaction/highlight";
import { capturePositions, tweenFrom } from "./interaction/animate";
import { Chrome } from "./ui/chrome";
import "./styles.css";

const state: ViewState = initialState();
const log = (level: "info" | "warn" | "error", text: string): void => postToHost({ type: "log", generation: state.generation, level, text });

const app = document.getElementById("app")!;
const canvas = document.getElementById("canvas")!;
const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
svg.setAttribute("class", "schematic");
svg.setAttribute("width", "100%");
svg.setAttribute("height", "100%");
const viewport = document.createElementNS("http://www.w3.org/2000/svg", "g");
viewport.setAttribute("class", "viewport");
svg.append(viewport);
canvas.append(svg);

const elkWorkerUri = document.body.dataset["elkWorkerUri"];
const elk = new ElkRunner({ workerScriptUri: elkWorkerUri, log: (l, t) => log(l, t) });
const zoomer = new ZoomController(svg, viewport);

let renderSeq = 0;
let lastRendered: { width: number; height: number; module: string } | undefined;
let cursor: Cursor | null = null;
let tweened = 0;

const chrome = new Chrome(app, {
  onFit: () => fit(true),
  onZoomIn: () => zoomer.zoomBy(1.25),
  onZoomOut: () => zoomer.zoomBy(0.8),
  onSelectTop: (name) => postToHost({ type: "selectTop", generation: state.generation, top: name }),
  onExport: (format) => void exportDiagram(format),
  onOpenInPanel: () => postToHost({ type: "openInPanel", generation: state.generation }),
  onDrillTo: (depth) => {
    // Breadcrumb index 0 is the top module, which is not part of the stack.
    state.stack = state.stack.slice(0, depth);
    void render(true);
  },
  onErrorClick: (err) => {
    if (err.line !== undefined) postToHost({ type: "revealError", generation: state.generation, line: err.line, column: err.column ?? 1 });
  },
  onHintAction: (command) => {
    if (command === "setLanguage") postToHost({ type: "setLanguage", generation: state.generation, language: "verilog" });
  },
});

function fit(animate: boolean): void {
  if (!lastRendered) return;
  zoomer.fit(lastRendered.width, lastRendered.height, animate);
  state.fitted = true;
}

function docToShow(): SchematicDoc | undefined {
  return state.doc;
}

async function render(fitNow: boolean): Promise<void> {
  const doc = docToShow();
  const seq = ++renderSeq;
  const name = currentModuleName(state);
  if (!doc || !name || !doc.modules[name]) {
    viewport.innerHTML = "";
    chrome.setEmpty(doc && doc.moduleNames.length === 0 ? "No module found yet. Start with: module top_module(input a, output b);" : "Open a Verilog file (.v or .sv) to see its schematic.");
    chrome.setBreadcrumb([]);
    return;
  }
  chrome.setEmpty(null);
  const view = doc.modules[name]!;
  chrome.setModules(doc.moduleNames, doc.top);
  chrome.setBreadcrumb([doc.top, ...state.stack.filter((s) => s !== doc.top)]);
  let rendered;
  try {
    const t0 = performance.now();
    const firstLayout = elk.mode === "none";
    const layout = await elk.layout(moduleToElk(view));
    if (firstLayout) log("info", `layout engine: ${elk.mode}`);
    if (seq !== renderSeq) return; // superseded
    rendered = renderModule(view, layout, { frame: true });
    const t1 = performance.now();
    if (t1 - t0 > 250) log("info", `layout ${name}: ${(t1 - t0).toFixed(0)} ms (${view.nodes.length} nodes)`);
  } catch (e) {
    log("error", `layout failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const moduleChanged = lastRendered?.module !== name;
  const previous = moduleChanged ? new Map() : capturePositions(viewport);
  viewport.innerHTML = rendered.inner;
  tweened = tweenFrom(viewport, previous);
  lastRendered = { width: rendered.width, height: rendered.height, module: name };
  if (fitNow || moduleChanged || !state.fitted) fit(false);
  wireInteractions();
  highlightCursor();
  persist();
}

function highlightCursor(): void {
  const ids = applyCursorHighlight(viewport, cursor);
  postToHost({ type: "highlighted", generation: state.generation, ids });
}

function wireInteractions(): void {
  for (const el of viewport.querySelectorAll<SVGGElement>("g.node, g.port")) {
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const line = Number(el.dataset["line"]);
      if (!Number.isFinite(line)) return;
      postToHost({
        type: "revealSource",
        generation: state.generation,
        line,
        column: Number(el.dataset["column"]) || 1,
        endLine: Number(el.dataset["endLine"]) || line,
        endColumn: Number(el.dataset["endColumn"]) || 1,
      });
    });
    const drill = el.dataset["drill"];
    if (drill) {
      el.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        state.stack.push(drill);
        void render(true);
      });
    }
  }
}

async function exportDiagram(format: "svg" | "png"): Promise<void> {
  const { exportSvg, exportPng } = await import("./export");
  const data = format === "svg" ? exportSvg(viewport, lastRendered) : await exportPng(viewport, lastRendered);
  if (data) postToHost({ type: "export", generation: state.generation, format, data });
}

function persist(): void {
  try {
    vscodeApi().setState({ stack: state.stack, transform: zoomer.transform });
  } catch {
    // ignore
  }
}

function handle(msg: HostToWebview): void {
  if (msg.type === "ping") {
    postToHost({ type: "pong", generation: state.generation, id: msg.id });
    return;
  }
  if (msg.generation < state.generation && msg.type !== "fit" && msg.type !== "export" && msg.type !== "drillUp" && msg.type !== "theme" && msg.type !== "hint") return;
  if (msg.generation > state.generation) state.generation = msg.generation;
  switch (msg.type) {
    case "render": {
      const topChanged = state.doc?.top !== msg.doc.top || state.doc?.sourceUri !== msg.doc.sourceUri;
      if (state.doc?.sourceUri !== msg.doc.sourceUri) log("info", `showing ${msg.doc.sourceUri}`);
      state.doc = msg.doc;
      if (topChanged) state.stack = [];
      // Drop drill-down entries that no longer exist.
      state.stack = state.stack.filter((s) => msg.doc.modules[s] !== undefined);
      void render(msg.fitOnRender || topChanged);
      break;
    }
    case "status":
      state.status = msg.status;
      chrome.setStatus(msg.status);
      break;
    case "error":
      state.error = msg.error;
      chrome.setError(msg.error);
      break;
    case "theme":
      state.theme = msg.theme;
      document.body.dataset["theme"] = msg.theme;
      break;
    case "fit":
      fit(true);
      break;
    case "export":
      void exportDiagram(msg.format);
      break;
    case "selectTop":
      state.stack = [];
      break;
    case "drillUp":
      if (state.stack.length > 0) {
        state.stack.pop();
        void render(true);
      }
      break;
    case "cursor":
      cursor = msg.cursor;
      highlightCursor();
      break;
    case "hint":
      chrome.setHint(msg.hint);
      break;
  }
}

window.addEventListener("message", (ev: MessageEvent<unknown>) => {
  if (!isHostToWebview(ev.data)) {
    log("warn", "dropped malformed host message");
    return;
  }
  try {
    handle(ev.data);
  } catch (e) {
    log("error", `handler failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  }
});

window.addEventListener("error", (ev) => log("error", `uncaught: ${ev.message}`));
window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => log("error", `unhandled rejection: ${String(ev.reason)}`));

window.addEventListener("keydown", (ev) => {
  if (ev.target instanceof HTMLSelectElement || ev.target instanceof HTMLInputElement) return;
  if (ev.key === "f") fit(true);
  else if (ev.key === "+" || ev.key === "=") zoomer.zoomBy(1.25);
  else if (ev.key === "-") zoomer.zoomBy(0.8);
  else if (ev.key === "Backspace" && state.stack.length > 0) {
    state.stack.pop();
    void render(true);
  }
});

chrome.setStatus(state.status);
try {
  const saved = vscodeApi().getState() as { stack?: string[] } | undefined;
  if (saved?.stack) state.stack = saved.stack;
} catch {
  // ignore
}
window.__rtlLiveTestHooks = { ...(window.__rtlLiveTestHooks ?? {}), state, elk, tweenCount: () => tweened };
postToHost({ type: "ready", generation: 0 });
