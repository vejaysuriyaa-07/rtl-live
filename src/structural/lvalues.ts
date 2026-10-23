// Left-hand sides of assignments, split into the signals and literal bit ranges they write.
// Used by the driver analysis (bug 16): two writes to disjoint bits of one vector are legal.
import { splitTopLevel } from "./textUtils";

export interface LvalueTarget {
  name: string;
  /** Literal bit range written; absent when the whole signal or a non-literal index is written */
  msb?: number;
  lsb?: number;
}

const TARGET_RE = /^\s*([A-Za-z_][\w$]*)\s*((?:\[[^\]]*\]\s*)*)$/;

function literalSelect(sel: string): { msb: number; lsb: number } | undefined {
  const range = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(sel);
  if (range && range[1] !== undefined && range[2] !== undefined) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { msb: Math.max(a, b), lsb: Math.min(a, b) };
  }
  const single = /^\s*(\d+)\s*$/.exec(sel);
  if (single && single[1] !== undefined) return { msb: Number(single[1]), lsb: Number(single[1]) };
  const indexed = /^\s*(\d+)\s*([+-]):\s*(\d+)\s*$/.exec(sel);
  if (indexed && indexed[1] !== undefined && indexed[3] !== undefined) {
    const base = Number(indexed[1]);
    const width = Number(indexed[3]);
    if (width < 1) return undefined;
    return indexed[2] === "+" ? { msb: base + width - 1, lsb: base } : { msb: base, lsb: base - width + 1 };
  }
  return undefined;
}

/** "{a, b[3:0]}" -> [{a}, {b, 3, 0}]. A non-literal or multi-dimensional select is a whole-signal write. */
export function parseLvalue(text: string): LvalueTarget[] {
  const t = text.trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    return splitTopLevel(t.slice(1, -1), ",").flatMap((part) => parseLvalue(part));
  }
  const m = TARGET_RE.exec(t);
  if (!m || m[1] === undefined) return [];
  const name = m[1];
  const selects = [...(m[2] ?? "").matchAll(/\[([^\]]*)\]/g)].map((s) => s[1] ?? "");
  if (selects.length !== 1) return [{ name }];
  const bits = literalSelect(selects[0]!);
  return bits ? [{ name, msb: bits.msb, lsb: bits.lsb }] : [{ name }];
}
