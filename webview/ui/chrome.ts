// Toolbar, status badge, banner and breadcrumb. Plain DOM, no framework.
import type { StatusInfo, BannerError, HintInfo } from "../../src/shared/protocol";

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
      button("Fit", "Fit diagram to view (f)", () => handlers.onFit()),
      button("+", "Zoom in (+)", () => handlers.onZoomIn()),
      button("−", "Zoom out (-)", () => handlers.onZoomOut()),
    );
    this.viewButtons = {
      rtl: button("RTL", "RTL view: shaped like the source (case is one mux, enable flops keep their EN pin)", () => handlers.onSetView("rtl"), "view-btn"),
      gate: button("Gate", "Gate view: what synthesis builds (enables and resets become muxes)", () => handlers.onSetView("gate"), "view-btn"),
    };
    const views = document.createElement("span");
    views.className = "tb-views";
    views.append(this.viewButtons.rtl, this.viewButtons.gate);
    toolbar.append(views);
    this.setView("rtl");
    this.topSelect = document.createElement("select");
    this.topSelect.className = "tb-select";
    this.topSelect.title = "Top module";
    this.topSelect.addEventListener("change", () => handlers.onSelectTop(this.topSelect.value));
    toolbar.append(this.topSelect);
    const spacer = document.createElement("span");
    spacer.className = "tb-spacer";
    toolbar.append(spacer);
    toolbar.append(
      button("SVG", "Export SVG", () => handlers.onExport("svg")),
      button("PNG", "Export PNG (2x)", () => handlers.onExport("png")),
      button("↗", "Open in editor panel", () => handlers.onOpenInPanel()),
    );
    this.bannerEl.addEventListener("click", () => {
      if (this.currentError) handlers.onErrorClick(this.currentError);
    });
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
    this.bannerEl.title = "Click to jump to the error";
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
