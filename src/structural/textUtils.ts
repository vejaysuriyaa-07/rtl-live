// Text-level helpers shared by the tree-sitter parser (for recovery inside
// ERROR nodes and for always-block analysis) and the fallback scanner.
import type { SrcRange } from "../ir/types";
import type { SAlways } from "./types";

export const KEYWORDS: ReadonlySet<string> = new Set([
  "module", "endmodule", "input", "output", "inout", "wire", "reg", "logic", "assign", "always",
  "always_comb", "always_ff", "always_latch", "begin", "end", "if", "else", "case", "casez", "casex",
  "endcase", "default", "posedge", "negedge", "or", "and", "not", "localparam", "parameter", "integer",
  "signed", "unsigned", "for", "while", "initial", "function", "endfunction", "task", "endtask",
  "generate", "endgenerate", "genvar", "return", "xor", "nand", "nor", "xnor", "buf",
]);

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_$]*/g;
const NUMBER_RE = /(?<![\w$])\d+\s*'\s*[sS]?[bBoOdDhH]\s*[0-9a-fA-FxXzZ_?]+|'[01xXzZ]|(?<![\w$])\d+(?:\.\d+)?/g;
const STRING_RE = /"(?:[^"\\]|\\.)*"/g;
const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

export function stripCommentsAndStrings(text: string): string {
  // Replace with same-length whitespace so positions stay valid.
  const blank = (m: string): string => m.replace(/[^\n]/g, " ");
  return text.replace(COMMENT_RE, blank).replace(STRING_RE, blank);
}

/** Identifiers in an expression, excluding keywords, number literals and system tasks. */
export function extractIdentifiers(expr: string): string[] {
  const clean = stripCommentsAndStrings(expr).replace(NUMBER_RE, " ").replace(/\$\w+/g, " ");
  const out: string[] = [];
  for (const m of clean.matchAll(IDENT_RE)) {
    const id = m[0];
    if (!KEYWORDS.has(id)) out.push(id);
  }
  return out;
}

/** Maps character offsets to 1-based line/column. */
export class LineIndex {
  private readonly starts: number[] = [0];
  constructor(text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }
  pos(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (this.starts[lo] ?? 0) + 1 };
  }
  range(start: number, end: number): SrcRange {
    const a = this.pos(start);
    const b = this.pos(end);
    return { line: a.line, column: a.column, endLine: b.line, endColumn: b.column };
  }
}

export interface ParsedConnection {
  port?: string;
  index: number;
  exprText: string;
  idents: string[];
  isConst: boolean;
  start: number;
  end: number;
}

/** Parse the inside of an instance port list "(.a(x), .b(y))" or "(x, y)" from text. */
export function parseConnectionText(inner: string, baseOffset: number): ParsedConnection[] {
  const out: ParsedConnection[] = [];
  const parts = splitTopLevel(inner, ",");
  let offset = baseOffset;
  let index = 0;
  for (const p of parts) {
    const partStart = offset;
    offset += p.length + 1;
    const trimmed = p.trim();
    if (trimmed === "") continue;
    const lead = p.length - p.trimStart().length;
    const start = partStart + lead;
    const end = start + trimmed.length;
    const nm = /^\.\s*([A-Za-z_][\w$]*)\s*(?:\(([\s\S]*?)\)?)?$/.exec(trimmed);
    if (nm && nm[1]) {
      const exprText = (nm[2] ?? "").trim();
      out.push({ port: nm[1], index: index++, exprText, idents: uniq(extractIdentifiers(exprText)), isConst: isConstLiteralText(exprText), start, end });
    } else {
      out.push({ index: index++, exprText: trimmed, idents: uniq(extractIdentifiers(trimmed)), isConst: isConstLiteralText(trimmed), start, end });
    }
  }
  return out;
}

function isConstLiteralText(text: string): boolean {
  const t = text.trim();
  return /^\d+\s*'\s*[sS]?[bBoOdDhH]\s*[0-9a-fA-FxXzZ_?]+$/.test(t) || /^\d+$/.test(t) || /^'[01xXzZ]$/.test(t);
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Split on a separator at nesting depth 0 of (), [], {}. */
export function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== "" || out.length > 0) out.push(cur);
  return out;
}

const LVALUE_RE = /([A-Za-z_][\w$]*)(?:\s*\[[^\]]*\])*\s*<?=(?!=)/g;
const CONCAT_LVALUE_RE = /\{([^{}]*)\}\s*<?=(?!=)/g;

/** Analyze an always block from its text: kind, sensitivity, assigned and read identifiers. */
export function analyzeAlwaysText(text: string, src: SrcRange): SAlways {
  const clean = stripCommentsAndStrings(text);
  const keywordMatch = /^\s*(always_comb|always_ff|always_latch|always)\b/.exec(clean);
  const keyword = keywordMatch?.[1] ?? "always";
  let sensitivity = "";
  const at = /@\s*(\*|\([\s\S]*?\))/.exec(clean);
  if (at) sensitivity = `@${at[1] ?? ""}`;
  const edge = /\b(posedge|negedge)\b/.test(sensitivity);
  const kind = keyword === "always_ff" || edge ? "seq" : "comb";
  const clocks: string[] = [];
  for (const m of sensitivity.matchAll(/\b(?:posedge|negedge)\s+([A-Za-z_][\w$]*)/g)) {
    if (m[1]) clocks.push(m[1]);
  }
  const body = at ? clean.slice((at.index ?? 0) + at[0].length) : clean.replace(/^\s*always\w*\b/, "");
  const assigned: string[] = [];
  const lhsTexts: string[] = [];
  for (const m of body.matchAll(CONCAT_LVALUE_RE)) {
    for (const id of extractIdentifiers(m[1] ?? "")) assigned.push(id);
    lhsTexts.push(`{${(m[1] ?? "").trim()}}`);
  }
  for (const m of body.matchAll(LVALUE_RE)) {
    if (m[1]) {
      assigned.push(m[1]);
      lhsTexts.push(m[0].replace(/\s*<?=$/, "").trim());
    }
  }
  // Reads: every identifier in the body once the left sides are blanked out.
  // A signal that is both assigned and read (counters: q <= q + 1) stays in read.
  const readSet = new Set<string>();
  const bodyNoLhs = body.replace(CONCAT_LVALUE_RE, " = ").replace(LVALUE_RE, " = ");
  for (const id of extractIdentifiers(bodyNoLhs)) readSet.add(id);
  return {
    kind,
    sensitivity,
    assigned: uniq(assigned),
    lhsTexts,
    read: [...readSet],
    clocks: uniq(clocks),
    src,
  };
}
