// Specific syntax error messages (bug 3). tree-sitter-verilog usually wraps a
// broken module in one ERROR node that says nothing about what is missing, so
// this pass scans the text itself: unbalanced brackets (with what they were
// opening), module/endmodule and begin/end pairs, statements that never reach
// their ';', a port list that lost a ',', and an operator with nothing after it.
// Positions are 1-based line and column of the place where the missing piece
// belongs (the end of the last good token), including the end of the file.
import type { SError } from "./types";
import { LineIndex } from "./textUtils";

interface Tok {
  text: string;
  start: number;
  end: number;
}

const DIRECTIONS = new Set(["input", "output", "inout"]);
const TYPE_WORDS = new Set(["wire", "reg", "logic", "signed", "unsigned", "integer", "bit", "byte", "int", "var", "tri"]);
const STATEMENT_KEYWORDS = new Set(["assign", "always", "always_comb", "always_ff", "always_latch", "initial", "endmodule", "module", "wire", "reg", "logic", "localparam", "parameter", "integer", "genvar", "generate", "endgenerate", "function", "endfunction", "task", "endtask"]);
const BLOCK_STOPS = new Set(["end", "endmodule", "always", "always_comb", "always_ff", "assign", "if", "else", "case", "endcase", "begin", "default", "initial", "for", "while"]);
const OPERATOR_TAIL = new Set(["&", "|", "^", "=", "+", "-", "*", "/", "%", "<", ">", "!", "~", "?", ":", ",", "<=", "==", "!=", "&&", "||", "<<", ">>", "~^", "^~", "~&", "~|"]);

/** Replace comments with spaces and strings with a single placeholder digit (newlines and positions kept). */
export function maskCommentsAndStrings(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < text.length) {
        out += "  ";
        i += 2;
      }
    } else if (ch === '"') {
      // A string is still an operand: leave one digit behind so "a = \"x\";" is complete.
      out += "0";
      i++;
      while (i < text.length && text[i] !== '"' && text[i] !== "\n") {
        if (text[i] === "\\") {
          out += " ";
          i++;
        }
        out += " ";
        i++;
      }
      if (i < text.length && text[i] === '"') {
        out += " ";
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const TOKEN = /[A-Za-z_$][\w$]*|\d*'[sS]?[bBoOdDhH][0-9a-fA-FxXzZ_?]+|\d[\d_]*(?:\.\d+)?|<=|>=|==|!=|&&|\|\||<<|>>|~\^|\^~|~&|~\||[(){}[\];,.:@#=~!&|^+\-*/%<>?]/g;

export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const clean = maskCommentsAndStrings(text);
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(clean)) !== null) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

interface Issue {
  offset: number;
  message: string;
  /** Lower ranks win when two issues share a position (a missing operand beats "missing endmodule") */
  rank: number;
}

function isIdent(t: Tok | undefined): boolean {
  return t !== undefined && /^[A-Za-z_$]/.test(t.text) && !STATEMENT_KEYWORDS.has(t.text) && !BLOCK_STOPS.has(t.text) && !DIRECTIONS.has(t.text) && !TYPE_WORDS.has(t.text);
}

type ParenKind = "portlist" | "connection" | "instance" | "sensitivity" | "paren" | "bracket" | "brace";

interface Open {
  kind: ParenKind;
  tok: Tok;
  /** .name for connection parens */
  name?: string;
}

function closerFor(kind: ParenKind): string {
  return kind === "bracket" ? "]" : kind === "brace" ? "}" : ")";
}

function unclosedMessage(o: Open): string {
  switch (o.kind) {
    case "portlist":
      return "missing ')' to close the port list";
    case "connection":
      return `missing ')' to close the connection to '${o.name ?? "?"}'`;
    case "instance":
      return "missing ')' to close the instance connections";
    case "sensitivity":
      return "missing ')' to close the sensitivity list";
    case "bracket":
      return "missing ']'";
    case "brace":
      return "missing '}'";
    default:
      return "missing ')'";
  }
}

/** Scan the text and describe what is missing. Never throws. */
export function describeSyntaxErrors(text: string): SError[] {
  const toks = tokenize(text);
  const lines = new LineIndex(text);
  const issues: Issue[] = [];
  const endOfFile = text.replace(/\s+$/, "").length;
  if (toks.length === 0) return [];

  // 1. Brackets, with the construct they open.
  const stack: Open[] = [];
  const unclosedDepthZeroStops = (t: Tok): boolean => STATEMENT_KEYWORDS.has(t.text) && t.text !== "wire" && t.text !== "reg" && t.text !== "logic";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const prev = toks[i - 1];
    const prev2 = toks[i - 2];
    if (t.text === "(" || t.text === "[" || t.text === "{") {
      let kind: ParenKind = t.text === "[" ? "bracket" : t.text === "{" ? "brace" : "paren";
      let name: string | undefined;
      if (t.text === "(") {
        if (prev && prev2 && prev2.text === "module" && isIdent(prev)) kind = "portlist";
        else if (prev && prev2 && prev2.text === "." && isIdent(prev)) {
          kind = "connection";
          name = prev.text;
        } else if (prev && prev.text === "@") kind = "sensitivity";
        else if (prev && prev2 && isIdent(prev) && isIdent(prev2) && !stack.some((o) => o.kind === "portlist")) kind = "instance";
      }
      stack.push({ kind, tok: t, ...(name !== undefined ? { name } : {}) });
      continue;
    }
    if (t.text === ")" || t.text === "]" || t.text === "}") {
      const top = stack[stack.length - 1];
      if (!top) {
        issues.push({ offset: t.start, message: `unexpected '${t.text}'`, rank: 1 });
        continue;
      }
      if (closerFor(top.kind) !== t.text) {
        issues.push({ offset: t.start, message: `${unclosedMessage(top)} before '${t.text}'`, rank: 1 });
        stack.pop();
        continue;
      }
      stack.pop();
      continue;
    }
    // A statement keyword while a port list, instance or connection is still open: that bracket never closed.
    // "wire w;" after the header is a declaration, "input wire a" inside the list is not.
    const declInPortList = (t.text === "wire" || t.text === "reg" || t.text === "logic") && stack[stack.length - 1]?.kind === "portlist" && prev !== undefined && !DIRECTIONS.has(prev.text) && prev.text !== "," && prev.text !== "(";
    if (stack.length > 0 && (unclosedDepthZeroStops(t) || declInPortList)) {
      const open = stack[stack.length - 1]!;
      let k = i - 1;
      while (k > 0 && toks[k]!.text === ";") k--;
      issues.push({ offset: toks[k]!.end, message: unclosedMessage(open), rank: 1 });
      stack.length = 0;
    }
  }
  // Innermost first: ".in2(" before "u1(".
  for (const o of [...stack].reverse()) {
    issues.push({ offset: endOfFile, message: unclosedMessage(o), rank: 1 });
  }

  // 2. module/endmodule, begin/end, case/endcase.
  let moduleOpen: Tok | undefined;
  let beginDepth = 0;
  let caseDepth = 0;
  let lastTok: Tok = toks[0]!;
  for (const t of toks) {
    if (t.text === "module") {
      if (moduleOpen) issues.push({ offset: lastTok.end, message: "missing endmodule", rank: 2 });
      moduleOpen = t;
      beginDepth = 0;
      caseDepth = 0;
    } else if (t.text === "endmodule") {
      if (beginDepth > 0) issues.push({ offset: lastTok.end, message: "missing end", rank: 2 });
      if (caseDepth > 0) issues.push({ offset: lastTok.end, message: "missing endcase", rank: 2 });
      if (!moduleOpen) issues.push({ offset: t.start, message: "unexpected endmodule", rank: 2 });
      moduleOpen = undefined;
      beginDepth = 0;
      caseDepth = 0;
    } else if (t.text === "begin") beginDepth++;
    else if (t.text === "end") {
      if (beginDepth > 0) beginDepth--;
      else issues.push({ offset: t.start, message: "unexpected 'end'", rank: 2 });
    } else if (t.text === "case" || t.text === "casez" || t.text === "casex") caseDepth++;
    else if (t.text === "endcase") {
      if (caseDepth > 0) caseDepth--;
    }
    lastTok = t;
  }
  if (moduleOpen) {
    if (beginDepth > 0) issues.push({ offset: endOfFile, message: "missing end", rank: 2 });
    if (caseDepth > 0) issues.push({ offset: endOfFile, message: "missing endcase", rank: 2 });
    issues.push({ offset: endOfFile, message: "missing endmodule", rank: 3 });
  }

  // 3. Port list items: a missing ',' between two ports, and ';' after the list.
  for (let i = 0; i + 2 < toks.length; i++) {
    if (toks[i]!.text !== "module" || !isIdent(toks[i + 1]) || toks[i + 2]!.text !== "(") continue;
    let depth = 0;
    let j = i + 2;
    for (; j < toks.length; j++) {
      const t = toks[j]!;
      if (t.text === "(" || t.text === "[" || t.text === "{") depth++;
      else if (t.text === ")" || t.text === "]" || t.text === "}") {
        depth--;
        if (depth === 0) break;
      } else if (depth === 1) {
        const prev = toks[j - 1];
        if (DIRECTIONS.has(t.text) && prev && isIdent(prev)) issues.push({ offset: t.start, message: `missing ',' before '${t.text}'`, rank: 0 });
        else if (isIdent(t) && prev && isIdent(prev)) issues.push({ offset: t.start, message: `missing ',' before '${t.text}'`, rank: 0 });
      } else if (unclosedDepthZeroStops(t)) break;
    }
    if (j < toks.length && toks[j]!.text === ")") {
      const after = toks[j + 1];
      if (!after || after.text !== ";") issues.push({ offset: toks[j]!.end, message: "missing ';' after the port list", rank: 0 });
    }
  }

  // 4. Statements that never reach ';': assign, declarations, instances, procedural assignments.
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.text === "(" || t.text === "[" || t.text === "{") {
      depth++;
      continue;
    }
    if (t.text === ")" || t.text === "]" || t.text === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    const next = toks[i + 1];
    const startsAssign = t.text === "assign" || t.text === "localparam" || t.text === "parameter";
    const startsDecl = (t.text === "wire" || t.text === "reg" || t.text === "logic" || t.text === "integer") && toks[i - 1]?.text !== "input" && toks[i - 1]?.text !== "output" && toks[i - 1]?.text !== "inout";
    const startsProc = isIdent(t) && next !== undefined && (next.text === "=" || next.text === "<=" || (next.text === "[" && false));
    const startsInstance = isIdent(t) && next !== undefined && isIdent(next) && toks[i + 2]?.text === "(";
    if (!(startsAssign || startsDecl || startsProc || startsInstance)) continue;
    // Walk to the terminator.
    let d = 0;
    let last: Tok = t;
    let terminated = false;
    let j = i + 1;
    for (; j < toks.length; j++) {
      const u = toks[j]!;
      if (u.text === "(" || u.text === "[" || u.text === "{") d++;
      else if (u.text === ")" || u.text === "]" || u.text === "}") {
        if (d === 0) break;
        d--;
      } else if (d === 0 && u.text === ";") {
        terminated = true;
        break;
      } else if (d === 0 && (STATEMENT_KEYWORDS.has(u.text) || BLOCK_STOPS.has(u.text))) break;
      else if (d === 0 && startsProc && isIdent(u) && toks[j + 1] !== undefined && (toks[j + 1]!.text === "=" || toks[j + 1]!.text === "<=")) break;
      last = u;
    }
    if (terminated) {
      // "assign y = a &;" ends properly but the expression does not.
      if (last !== t && OPERATOR_TAIL.has(last.text)) issues.push({ offset: last.end, message: `missing operand after '${last.text}'`, rank: 0 });
      i = j;
      continue;
    }
    if (d > 0) {
      // An unclosed bracket inside the statement; the bracket pass reports it.
    } else if (OPERATOR_TAIL.has(last.text)) issues.push({ offset: last.end, message: `missing operand after '${last.text}'`, rank: 0 });
    else if (last.text === "(" || last.text === "{" || last.text === "[") {
      // reported by the bracket pass
    } else if (last !== t || !startsAssign) issues.push({ offset: last.end, message: "missing ';'", rank: 0 });
    i = Math.max(i, j - 1);
  }

  // Dedupe (same message at the same spot) and sort by position.
  const seen = new Set<string>();
  const out: SError[] = [];
  for (const it of issues.sort((a, b) => a.offset - b.offset || a.rank - b.rank)) {
    const p = lines.pos(Math.min(it.offset, text.length));
    const key = `${p.line}:${p.column}:${it.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ line: p.line, column: p.column, message: it.message });
  }
  return out;
}

/** Text right after a position, for "syntax error near" messages. */
function tokenAt(text: string, line: number, column: number): string {
  const lines = text.split("\n");
  const l = lines[line - 1] ?? "";
  const rest = l.slice(Math.max(0, column - 1)).trim();
  const m = /^[A-Za-z_$][\w$]*|^\S+/.exec(rest);
  return m?.[0] ?? "";
}

/**
 * Replace the parser's generic errors with the specific ones from the text
 * scan. tree-sitter MISSING nodes are already specific and are kept (their
 * token types become quoted tokens). A parser error that nothing explains
 * becomes "syntax error near '<token>'".
 */
export function refineErrors(text: string, parserErrors: SError[]): SError[] {
  const specific = describeSyntaxErrors(text);
  const kept: SError[] = [];
  for (const e of parserErrors) {
    const m = /^missing (.+)$/.exec(e.message);
    if (m && e.message !== "missing endmodule") {
      const tok = m[1]!;
      const msg = /^[A-Za-z]/.test(tok) ? `missing ${tok}` : `missing '${tok}'`;
      if (!specific.some((s) => s.line === e.line && s.message.startsWith(msg))) kept.push({ ...e, message: msg });
    } else if (specific.length === 0 && (e.message === "syntax error" || e.message.startsWith("fallback parser"))) {
      const near = tokenAt(text, e.line, e.column);
      kept.push({ ...e, message: near ? `syntax error near '${near}'` : "syntax error" });
    } else if (specific.length === 0) kept.push(e);
  }
  const all = [...specific, ...kept];
  all.sort((a, b) => a.line - b.line || a.column - b.column);
  return all;
}

/** Friendlier wording for a Verilator error line. */
export function friendlyVerilatorMessage(message: string): string {
  const m = /syntax error, unexpected (.+?)(?:, expecting (.+))?$/.exec(message);
  if (!m) return message.replace(/^syntax error,?\s*/, "syntax error: ");
  const unexpected = m[1]!.replace(/^TOKEN_?/, "").replace(/^'(.*)'$/, "$1");
  const expecting = m[2]?.split(" or ")[0]?.replace(/^'(.*)'$/, "$1");
  if (expecting) return `missing '${expecting}' before '${unexpected}'`;
  return `unexpected '${unexpected}'`;
}
