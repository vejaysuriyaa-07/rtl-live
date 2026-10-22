// Width helpers shared by both structural parsers.

export interface RangeInfo {
  width: number;
  range: string;
}

const LITERAL_RANGE = /^\s*\[\s*(\d+)\s*:\s*(\d+)\s*\]\s*$/;

/** "[7:0]" -> { width: 8, range: "[7:0]" }; "[N-1:0]" -> { width: 0, range: "[N-1:0]" } */
export function parseRange(text: string | undefined): RangeInfo | undefined {
  if (!text) return undefined;
  const range = text.replace(/\s+/g, "");
  const m = LITERAL_RANGE.exec(text);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return { width: Math.abs(a - b) + 1, range };
  }
  return { width: 0, range };
}

/** Width of a sized literal like 4'd5 or 1'b0; undefined for unsized/other text. */
export function literalWidth(text: string): number | undefined {
  const m = /^\s*(\d+)\s*'\s*[sS]?[bBoOdDhH]/.exec(text);
  if (m && m[1] !== undefined) return Number(m[1]);
  return undefined;
}

export function isConstLiteral(text: string): boolean {
  const t = text.trim();
  return /^\d+\s*'\s*[sS]?[bBoOdDhH]\s*[0-9a-fA-FxXzZ_?]+$/.test(t) || /^\d+$/.test(t) || /^'[01xXzZ]$/.test(t);
}

/** Width of a bit select or part select text like "[3]" or "[15:8]"; undefined when not literal. */
export function selectWidth(selText: string): number | undefined {
  const r = parseRange(selText);
  if (r && r.width > 0) return r.width;
  if (/^\s*\[\s*\d+\s*\]\s*$/.test(selText)) return 1;
  const pm = /^\s*\[\s*[^:\]]+\s*[+-]:\s*(\d+)\s*\]\s*$/.exec(selText);
  if (pm && pm[1] !== undefined) return Number(pm[1]);
  return undefined;
}
