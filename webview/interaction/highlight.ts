// Editor cursor -> diagram highlight. Elements carry data-src="l:c:el:ec;..." ranges.
export interface Cursor {
  line: number;
  column: number;
}

function contains(range: string, c: Cursor): boolean {
  const [l, col, el, ec] = range.split(":").map(Number);
  if (l === undefined || col === undefined || el === undefined || ec === undefined) return false;
  const afterStart = c.line > l || (c.line === l && c.column >= col);
  const beforeEnd = c.line < el || (c.line === el && c.column <= ec);
  return afterStart && beforeEnd;
}

/** Applies the highlight class and returns the ids of highlighted nodes, ports and nets. */
export function applyCursorHighlight(root: Element, cursor: Cursor | null): string[] {
  const ids: string[] = [];
  for (const el of root.querySelectorAll<SVGGElement>("[data-src]")) {
    const hit = cursor !== null && (el.dataset["src"] ?? "").split(";").some((r) => contains(r, cursor));
    el.classList.toggle("highlight", hit);
    if (hit) ids.push(el.dataset["id"] ?? el.dataset["net"] ?? "");
  }
  return ids;
}
