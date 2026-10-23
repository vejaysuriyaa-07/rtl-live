// Focus mode (BUG_HUNT.md Part B): hovering a wire or a symbol highlights its whole net
// (every segment, every connected symbol) and dims everything else. Escape clears it.
import type { ModuleView } from "../../src/ir/types";
import { focusNets, focusSymbols } from "./focusModel";

export const FOCUS_CLASS = "focus";
export const FOCUSED_CLASS = "focused";

export class FocusController {
  private view: ModuleView | undefined;
  private active = false;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly viewport: SVGGElement,
  ) {
    viewport.addEventListener("mouseover", (ev) => this.onOver(ev));
    viewport.addEventListener("mouseleave", () => this.clear());
    svg.addEventListener("mouseleave", () => this.clear());
  }

  setView(view: ModuleView | undefined): void {
    this.view = view;
    this.clear();
  }

  get isActive(): boolean {
    return this.active;
  }

  private onOver(ev: Event): void {
    const el = ev.target instanceof Element ? ev.target : null;
    if (!el || !this.view) return;
    const group = el.closest<SVGGElement>("g.net, g.node, g.port");
    if (!group) {
      this.clear();
      return;
    }
    const target = group.classList.contains("net") ? { net: group.dataset["net"] ?? "" } : group.classList.contains("port") ? { port: group.dataset["port"] ?? "" } : { node: group.dataset["id"] ?? "" };
    this.apply(focusNets(this.view, target), group);
  }

  private apply(nets: Set<string>, hovered: SVGGElement): void {
    if (!this.view) return;
    const symbols = focusSymbols(this.view, nets);
    this.svg.classList.add(FOCUS_CLASS);
    this.active = true;
    for (const g of this.viewport.querySelectorAll<SVGGElement>("g.net")) g.classList.toggle(FOCUSED_CLASS, nets.has(g.dataset["net"] ?? ""));
    for (const g of this.viewport.querySelectorAll<SVGGElement>("g.node, g.port")) g.classList.toggle(FOCUSED_CLASS, g === hovered || symbols.has(g.dataset["id"] ?? ""));
  }

  clear(): void {
    if (!this.active) return;
    this.active = false;
    this.svg.classList.remove(FOCUS_CLASS);
    for (const g of this.viewport.querySelectorAll<SVGGElement>(`.${FOCUSED_CLASS}`)) g.classList.remove(FOCUSED_CLASS);
  }
}
