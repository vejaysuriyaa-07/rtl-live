// Stale-diagram overlay (bug 2): while the newest text does not parse or has
// not been synthesized yet, the last good synthesized diagram stays on screen
// and the ports that changed in the structural parse are drawn on top of it
// in a muted style, so the badge ("Stale") and the drawing always agree.
import type { Port, SchematicDoc } from "./types";

export interface OverlaySummary {
  added: string[];
  removed: string[];
  changed: string[];
}

export function overlaySummaryText(s: OverlaySummary): string {
  const parts: string[] = [];
  if (s.added.length > 0) parts.push(`${s.added.length} port${s.added.length === 1 ? "" : "s"} added`);
  if (s.removed.length > 0) parts.push(`${s.removed.length} removed`);
  if (s.changed.length > 0) parts.push(`${s.changed.length} changed`);
  return parts.join(", ");
}

function samePort(a: Port, b: Port): boolean {
  return a.direction === b.direction && a.width === b.width;
}

/**
 * Returns lastGood with the top module's port list reconciled against the
 * structural doc: new ports appended as ghost "added", missing ones kept as
 * ghost "removed", direction or width changes marked "changed". Nodes and
 * nets are untouched. Diagnostics come from the structural parse.
 */
export function overlayStructural(lastGood: SchematicDoc, structural: SchematicDoc, generation: number): { doc: SchematicDoc; summary: OverlaySummary } {
  const summary: OverlaySummary = { added: [], removed: [], changed: [] };
  const top = lastGood.top;
  const good = lastGood.modules[top];
  const fresh = structural.modules[top];
  if (!good || !fresh) {
    return { doc: { ...lastGood, generation, diagnostics: structural.diagnostics }, summary };
  }
  const freshByName = new Map(fresh.ports.map((p) => [p.name, p]));
  const ports: Port[] = [];
  for (const p of good.ports) {
    const f = freshByName.get(p.name);
    const { ghost: _g, ...clean } = p;
    if (!f) {
      summary.removed.push(p.name);
      ports.push({ ...clean, ghost: "removed" });
    } else if (!samePort(p, f)) {
      summary.changed.push(p.name);
      ports.push({ ...clean, direction: f.direction, width: f.width, ...(f.range !== undefined ? { range: f.range } : {}), src: f.src, ghost: "changed" });
    } else {
      ports.push({ ...clean, src: f.src });
    }
  }
  const goodNames = new Set(good.ports.map((p) => p.name));
  for (const f of fresh.ports) {
    if (goodNames.has(f.name)) continue;
    summary.added.push(f.name);
    ports.push({ ...f, ghost: "added" });
  }
  const doc: SchematicDoc = {
    ...lastGood,
    generation,
    diagnostics: structural.diagnostics,
    moduleNames: structural.moduleNames.length > 0 ? structural.moduleNames : lastGood.moduleNames,
    modules: { ...lastGood.modules, [top]: { ...good, ports } },
  };
  return { doc, summary };
}
