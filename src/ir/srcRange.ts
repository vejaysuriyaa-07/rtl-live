import type { SrcRange } from "./types";

/** Parse a Yosys src attribute like "input.v:2.3-2.20|input.v:5.1-5.9" into ranges. */
export function parseSrc(attr: string | number | undefined, file = "input.v"): SrcRange[] {
  if (typeof attr !== "string" || attr === "") return [];
  const out: SrcRange[] = [];
  for (const part of attr.split("|")) {
    const m = /^(.*?):(\d+)\.(\d+)-(\d+)\.(\d+)$/.exec(part.trim());
    if (!m) continue;
    if (m[1] !== file) continue;
    out.push({ line: Number(m[2]), column: Number(m[3]), endLine: Number(m[4]), endColumn: Number(m[5]) });
  }
  return out;
}
