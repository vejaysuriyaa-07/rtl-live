// Toolbar, status badge, banner and breadcrumb. Plain DOM, no framework.
import type { StatusInfo, BannerError, HintInfo } from "../../src/shared/protocol";
import { legendItems } from "./legend";
import { fmt } from "../render/svg";

export interface ChromeHandlers {
  onFit(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onSelectTop(name: string): void;
  onExport(format: "svg" | "png"): void;
  onOpenInPanel(): void;
  onDrillTo(depth: number): void;
  onErrorClick(err: BannerError): void;
  onHintAction(command: "setLanguage"): void;
  onSetView(view: "rtl" | "gate"): void;
}

function button(label: string, title: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `tb-btn ${cls}`.trim();
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

export class Chrome {
  private readonly topSelect: HTMLSelectElement;
  private readonly viewButtons: Record<"rtl" | "gate", HTMLButtonElement>;
  private readonly statusEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly breadcrumbEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly legendEl: HTMLElement;
  private readonly legendBtn: HTMLButtonElement;
  private currentError: BannerError | null = null;

  constructor(
    root: HTMLElement,
    private readonly handlers: ChromeHandlers,
  ) {
    const toolbar = root.querySelector<HTMLElement>("#toolbar")!;
    this.statusEl = root.querySelector<HTMLElement>("#status")!;
    this.bannerEl = root.querySelector<HTMLElement>("#banner")!;
    this.breadcrumbEl = root.querySelector<HTMLElement>("#breadcrumb")!;
    this.emptyEl = root.querySelector<HTMLElement>("#empty")!;
    this.hintEl = document.createElement("div");
    this.hintEl.id = "hint";
    this.hintEl.hidden = true;
    this.bannerEl.insertAdjacentElement("afterend", this.hintEl);

    toolbar.append(
      button("Fit", "Fit the whole diagram in the view (f)", () => handlers.onFit()),
      button("+", "Zoom in (+)", () => handlers.onZoomIn()),
      button("−", "Zoom out (-)", () => handlers.onZoomOut()),
    );
    this.viewButtons = {
      rtl: button("RTL", "RTL view: drawn the way the code reads (a case is one mux, an enable stays a pin)", () => handlers.onSetView("rtl"), "view-btn"),
      gate: button("Gate", "Gate view: what synthesis builds (enables and resets become muxes)", () => handlers.onSetView("gate"), "view-btn"),
    };
    const views = document.createElement("span");
    views.className = "tb-views";
    views.append(this.viewButtons.rtl, this.viewButtons.gate);
    toolbar.append(views);
    this.setView("rtl");
    this.topSelect = document.createElement("select");
    this.topSelect.className = "tb-select";
    this.topSelect.title = "Which module to draw";
    this.topSelect.addEventListener("change", () => handlers.onSelectTop(this.topSelect.value));
    toolbar.append(this.topSelect);
    const spacer = document.createElement("span");
    spacer.className = "tb-spacer";
    toolbar.append(spacer);
    this.legendBtn = button("Legend", "What every symbol means (l)", () => this.toggleLegend(), "legend-btn");
    this.legendBtn.setAttribute("aria-pressed", "false");
    toolbar.append(
      this.legendBtn,
      button("SVG", "Save the diagram as an SVG file", () => handlers.onExport("svg")),
      button("PNG", "Save the diagram as a PNG image (2x)", () => handlers.onExport("png")),
      button("↗", "Open in an editor tab", () => handlers.onOpenInPanel()),
    );
    this.legendEl = document.createElement("div");
    this.legendEl.id = "legend";
    this.legendEl.setAttribute("role", "dialog");
    this.legendEl.setAttribute("aria-label", "Legend");
    this.legendEl.hidden = true;
    root.querySelector<HTMLElement>("#canvas")!.append(this.legendEl);
    this.bannerEl.addEventListener("click", () => {
      if (this.currentError) handlers.onErrorClick(this.currentError);
    });
  }

  toggleLegend(open?: boolean): void {
    const next = open ?? this.legendEl.hidden;
    // Built on open and emptied on close, so the samples never sit in the diagram's DOM.
    if (next) this.legendEl.replaceChildren(...buildLegend().children);
    else this.legendEl.replaceChildren();
    this.legendEl.hidden = !next;
    this.legendBtn.classList.toggle("active", next);
    this.legendBtn.setAttribute("aria-pressed", next ? "true" : "false");
  }

  get legendOpen(): boolean {
    return !this.legendEl.hidden;
  }

  setModules(names: string[], selected: string): void {
    const prev = this.topSelect.value;
    if (names.join("\u0000") !== Array.from(this.topSelect.options).map((o) => o.value).join("\u0000")) {
      this.topSelect.replaceChildren(
        ...names.map((n) => {
          const o = document.createElement("option");
          o.value = n;
          o.textContent = n;
          return o;
        }),
      );
    }
    if (prev !== selected || this.topSelect.value !== selected) this.topSelect.value = selected;
    this.topSelect.hidden = names.length <= 1;
  }

  setView(view: "rtl" | "gate"): void {
    for (const [k, b] of Object.entries(this.viewButtons)) {
      b.classList.toggle("active", k === view);
      b.setAttribute("aria-pressed", k === view ? "true" : "false");
    }
  }

  setStatus(s: StatusInfo): void {
    if (s.view) this.setView(s.view);
    const viewName = s.view === "gate" ? "Gate" : "RTL";
    const badge = s.warmingUp ? "Warming up" : s.fidelity === "synthesized" ? `${viewName} view` : s.fidelity === "stale" ? "Stale" : s.editing ? "Editing" : "Structural";
    const cls = s.warmingUp ? "warming" : s.editing && s.fidelity === "structural" ? "editing" : s.fidelity;
    const backend = s.backend === "none" || s.backend === "off" ? "" : ` · ${s.backend}${s.backendVersion ? ` ${s.backendVersion}` : ""}`;
    this.statusEl.innerHTML = "";
    const b = document.createElement("span");
    b.className = `badge badge-${cls}`;
    b.textContent = badge;
    b.title = s.warmingUp
      ? "Starting the Yosys synthesizer. The first diagram takes a moment."
      : s.fidelity === "synthesized"
        ? s.view === "gate"
          ? "Synthesized by Yosys and optimized into gates."
          : "Synthesized by Yosys and drawn the way the code reads."
        : s.fidelity === "stale"
          ? "The code changed or has an error. This is the last diagram that synthesized; changed ports are greyed."
          : s.editing
            ? "The code has a syntax error. Showing what could still be read from it."
            : "Drawn from the code text only, not yet synthesized into gates.";
    b.dataset["fidelity"] = s.fidelity;
    this.statusEl.append(b);
    const t = document.createElement("span");
    t.className = "status-text";
    t.textContent = `${s.message ?? ""}${backend}`;
    this.statusEl.append(t);
  }

  setError(err: BannerError | null): void {
    this.currentError = err;
    if (!err) {
      this.bannerEl.hidden = true;
      this.bannerEl.textContent = "";
      return;
    }
    const where = err.line !== undefined ? `${err.file ? `${err.file}:` : "line "}${err.line}${err.column !== undefined ? `:${err.column}` : ""}` : "";
    this.bannerEl.textContent = `${where ? `${where}  ` : ""}${err.message}`;
    this.bannerEl.title = "Click to jump to this line in the editor";
    this.bannerEl.hidden = false;
  }

  setHint(hint: HintInfo | null): void {
    this.hintEl.replaceChildren();
    if (!hint) {
      this.hintEl.hidden = true;
      return;
    }
    const text = document.createElement("span");
    text.textContent = hint.message;
    this.hintEl.append(text);
    if (hint.action) {
      const b = document.createElement("button");
      b.className = "tb-btn hint-action";
      b.textContent = hint.action.label;
      const command = hint.action.command;
      b.addEventListener("click", () => this.handlers.onHintAction(command));
      this.hintEl.append(b);
    }
    this.hintEl.hidden = false;
  }

  setBreadcrumb(path: string[]): void {
    if (path.length <= 1) {
      this.breadcrumbEl.hidden = true;
      this.breadcrumbEl.replaceChildren();
      return;
    }
    this.breadcrumbEl.hidden = false;
    this.breadcrumbEl.replaceChildren(
      ...path.flatMap((name, i) => {
        const a = document.createElement("a");
        a.href = "#";
        a.textContent = name;
        a.className = i === path.length - 1 ? "crumb current" : "crumb";
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          this.handlers.onDrillTo(i);
        });
        return i === 0 ? [a] : [document.createTextNode(" › "), a];
      }),
    );
  }

  setEmpty(message: string | null): void {
    if (message === null) {
      this.emptyEl.hidden = true;
    } else {
      this.emptyEl.hidden = false;
      this.emptyEl.textContent = message;
    }
  }
}

/** The panel's DOM: a list of samples with titles and one-line meanings. */
export function buildLegend(): HTMLElement {
  const root = document.createElement("div");
  root.id = "legend";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Legend");
  const head = document.createElement("div");
  head.className = "legend-head";
  head.textContent = "Legend";
  root.append(head);
  const list = document.createElement("div");
  list.className = "legend-list";
  for (const item of legendItems()) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.dataset["key"] = item.key;
    const pic = document.createElement("div");
    pic.className = "legend-pic";
    pic.innerHTML = `<svg class="schematic legend-svg" viewBox="0 0 ${fmt(item.width)} ${fmt(item.height)}" width="${fmt(Math.min(item.width, 96))}" height="${fmt(item.height * Math.min(1, 96 / item.width))}">${item.svg}</svg>`;
    const text = document.createElement("div");
    text.className = "legend-text";
    const title = document.createElement("div");
    title.className = "legend-title";
    title.textContent = item.title;
    const body = document.createElement("div");
    body.className = "legend-body";
    body.textContent = item.text;
    text.append(title, body);
    row.append(pic, text);
    list.append(row);
  }
  root.append(list);
  return root;
}
