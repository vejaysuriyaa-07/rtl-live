// Toolbar, status badge, banner and breadcrumb. Plain DOM, no framework.
import type { StatusInfo, BannerError } from "../../src/shared/protocol";

export interface ChromeHandlers {
  onFit(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onSelectTop(name: string): void;
  onExport(format: "svg" | "png"): void;
  onOpenInPanel(): void;
  onDrillTo(depth: number): void;
  onErrorClick(err: BannerError): void;
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
  private readonly statusEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly breadcrumbEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
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

    toolbar.append(
      button("Fit", "Fit diagram to view (f)", () => handlers.onFit()),
      button("+", "Zoom in (+)", () => handlers.onZoomIn()),
      button("−", "Zoom out (-)", () => handlers.onZoomOut()),
    );
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

  setStatus(s: StatusInfo): void {
    const badge = s.warmingUp ? "Warming up" : s.fidelity === "synthesized" ? "Synthesized" : s.fidelity === "stale" ? "Stale" : "Structural";
    const cls = s.warmingUp ? "warming" : s.fidelity;
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
