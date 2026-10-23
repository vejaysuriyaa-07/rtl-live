// 150 ms tween for nodes and ports that moved between renders. Positions are
// captured from the transform attribute before the DOM is replaced; moved
// elements get a CSS transform that undoes the move and then transition to none.
import { MOTION_MS } from "../render/tokens";

const DURATION_MS = MOTION_MS;

export type Positions = Map<string, { x: number; y: number }>;

function parseTranslate(el: Element): { x: number; y: number } | undefined {
  const t = el.getAttribute("transform") ?? "";
  const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(t);
  if (!m) return undefined;
  return { x: Number(m[1]), y: Number(m[2]) };
}

export function capturePositions(root: Element): Positions {
  const out: Positions = new Map();
  for (const el of root.querySelectorAll<SVGGElement>("g.node, g.port")) {
    const id = el.dataset["id"];
    const p = parseTranslate(el);
    if (id && p) out.set(id, p);
  }
  return out;
}

export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Call after the new markup is in place. Returns the number of tweened elements. */
export function tweenFrom(root: Element, previous: Positions): number {
  if (previous.size === 0 || reducedMotion()) return 0;
  let count = 0;
  const moved: SVGGElement[] = [];
  for (const el of root.querySelectorAll<SVGGElement>("g.node, g.port")) {
    const id = el.dataset["id"];
    const now = parseTranslate(el);
    const before = id ? previous.get(id) : undefined;
    if (!now || !before) continue;
    const dx = before.x - now.x;
    const dy = before.y - now.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    moved.push(el);
    count++;
  }
  if (moved.length === 0) return 0;
  // Force style flush, then animate back to the attribute position.
  void root.getBoundingClientRect();
  for (const el of moved) {
    el.style.transition = `transform ${DURATION_MS}ms ease-out`;
    el.style.transform = "";
    const done = (): void => {
      el.style.transition = "";
      el.removeEventListener("transitionend", done);
    };
    el.addEventListener("transitionend", done);
    setTimeout(done, DURATION_MS + 50);
  }
  return count;
}
