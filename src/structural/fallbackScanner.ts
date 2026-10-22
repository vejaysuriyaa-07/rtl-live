// Fallback structural parser: tolerant tokenizer plus recursive descent for the
// HDLBits subset. Used when the tree-sitter grammar wasm cannot be loaded.
// It must produce the same StructuralFile as the tree-sitter parser on the fixtures.
import { refineErrors } from "./errorMessages";
import type { PortDirection, SrcRange } from "../ir/types";
import type {
  SAlways,
  SAssign,
  SConnection,
  SDecl,
  SError,
  SInstance,
  SModule,
  SParam,
  SPort,
  StructuralFile,
  StructuralParser,
} from "./types";
import { parseRange } from "./width";
import { analyzeAlwaysText, extractIdentifiers, LineIndex, parseConnectionText, stripCommentsAndStrings, uniq } from "./textUtils";

type TokKind = "ident" | "number" | "punct" | "string";

interface Tok {
  kind: TokKind;
  text: string;
  start: number;
  end: number;
}

const TOKEN_RE =
  /(\d+\s*'\s*[sS]?[bBoOdDhH]\s*[0-9a-fA-FxXzZ_?]+|'[01xXzZ]|\d+(?:\.\d+)?)|([A-Za-z_][\w$]*|\\\S+)|("(?:[^"\\]|\\.)*")|(<=|>=|==|!=|===|!==|&&|\|\||<<|>>|~&|~\||~\^|\^~|->|\+:|-:|::|[(){}[\];,.=<>+\-*/%!~&|^?:@#$])/g;

function tokenize(text: string): Tok[] {
  const clean = stripCommentsAndStrings(text);
  const out: Tok[] = [];
  for (const m of clean.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const t = m[0];
    const kind: TokKind = m[1] !== undefined ? "number" : m[2] !== undefined ? "ident" : m[3] !== undefined ? "string" : "punct";
    out.push({ kind, text: t, start, end: start + t.length });
  }
  return out;
}

const DIRECTIONS: Record<string, PortDirection> = { input: "input", output: "output", inout: "inout" };
const ITEM_KEYWORDS = new Set(["assign", "always", "always_comb", "always_ff", "always_latch", "wire", "reg", "logic", "input", "output", "inout", "localparam", "parameter", "endmodule", "module", "initial", "integer", "genvar", "generate", "function", "task"]);

export class FallbackStructuralParser implements StructuralParser {
  readonly name = "fallback" as const;

  parse(text: string): StructuralFile {
    const toks = tokenize(text);
    const lines = new LineIndex(text);
    const errors: SError[] = [];
    const modules: SModule[] = [];
    // Split into module spans at each "module" keyword.
    const starts: number[] = [];
    toks.forEach((t, i) => {
      if (t.kind === "ident" && t.text === "module") starts.push(i);
    });
    for (let k = 0; k < starts.length; k++) {
      const from = starts[k] ?? 0;
      const to = starts[k + 1] ?? toks.length;
      const span = toks.slice(from, to);
      try {
        const m = new ModuleParser(text, span, lines, errors).parse();
        if (m) modules.push(m);
      } catch (e) {
        const at = span[0];
        errors.push({ ...(at ? lines.pos(at.start) : { line: 1, column: 1 }), message: `fallback parser: ${String(e)}` });
      }
    }
    if (starts.length === 0 && toks.length > 0) {
      const t0 = toks[0];
      errors.push({ ...(t0 ? lines.pos(t0.start) : { line: 1, column: 1 }), message: "no module found" });
    }
    const refined = refineErrors(text, errors);
    return { modules, errors: refined, hasErrors: errors.length > 0, parser: "fallback" };
  }
}

class ModuleParser {
  private i = 0;
  private hasErrors = false;
  private readonly ports: SPort[] = [];
  private readonly decls: SDecl[] = [];
  private readonly assigns: SAssign[] = [];
  private readonly always: SAlways[] = [];
  private readonly instances: SInstance[] = [];
  private readonly localparams: SParam[] = [];

  constructor(
    private readonly text: string,
    private readonly toks: Tok[],
    private readonly lines: LineIndex,
    private readonly errors: SError[],
  ) {}

  private peek(off = 0): Tok | undefined {
    return this.toks[this.i + off];
  }
  private next(): Tok | undefined {
    return this.toks[this.i++];
  }
  private isPunct(t: Tok | undefined, p: string): boolean {
    return t !== undefined && t.kind === "punct" && t.text === p;
  }
  private isIdent(t: Tok | undefined, s?: string): boolean {
    return t !== undefined && t.kind === "ident" && (s === undefined || t.text === s);
  }
  private error(t: Tok | undefined, message: string): void {
    this.hasErrors = true;
    const at = t ?? this.toks[this.toks.length - 1];
    this.errors.push({ ...(at ? this.lines.pos(at.start) : { line: 1, column: 1 }), message });
  }
  private rangeOfToks(a: Tok | undefined, b: Tok | undefined): SrcRange {
    const s = a?.start ?? 0;
    const e = b?.end ?? s;
    return this.lines.range(s, e);
  }
  private textBetween(a: Tok | undefined, b: Tok | undefined): string {
    if (!a) return "";
    return this.text.slice(a.start, b ? b.end : a.end);
  }

  parse(): SModule | undefined {
    const kw = this.next();
    if (!kw) return undefined;
    const nameTok = this.peek();
    if (!this.isIdent(nameTok)) {
      this.error(nameTok, "expected module name");
      return undefined;
    }
    this.next();
    const name = nameTok?.text ?? "";
    // Optional parameter port list #( ... )
    if (this.isPunct(this.peek(), "#")) {
      this.next();
      this.skipBalanced("(", ")");
    }
    if (this.isPunct(this.peek(), "(")) this.parsePortList();
    if (this.isPunct(this.peek(), ";")) this.next();
    else this.error(this.peek(), "expected ; after module header");
    let last: Tok | undefined = kw;
    while (this.i < this.toks.length) {
      const t = this.peek();
      if (!t) break;
      if (this.isIdent(t, "endmodule")) {
        last = this.next();
        break;
      }
      const before = this.i;
      this.parseItem();
      last = this.toks[this.i - 1] ?? last;
      if (this.i === before) this.next();
    }
    if (!last || last.text !== "endmodule") {
      this.hasErrors = true;
      this.errors.push({ ...this.lines.pos((this.toks[this.toks.length - 1] ?? kw).end), message: "missing endmodule" });
    }
    return {
      name,
      ports: this.ports,
      decls: this.decls,
      assigns: this.assigns,
      always: this.always,
      instances: this.instances,
      localparams: this.localparams,
      hasErrors: this.hasErrors,
      src: this.rangeOfToks(kw, last),
    };
  }

  private skipBalanced(open: string, close: string): void {
    if (!this.isPunct(this.peek(), open)) return;
    let depth = 0;
    while (this.i < this.toks.length) {
      const t = this.next();
      if (this.isPunct(t, open)) depth++;
      else if (this.isPunct(t, close)) {
        depth--;
        if (depth === 0) return;
      }
    }
    this.error(undefined, `unbalanced ${open}`);
  }

  /** Tokens up to (not including) the matching close paren at depth 0, or end. */
  private collectUntilClose(): Tok[] {
    const out: Tok[] = [];
    let depth = 0;
    while (this.i < this.toks.length) {
      const t = this.peek();
      if (!t) break;
      if (this.isPunct(t, "(") || this.isPunct(t, "[") || this.isPunct(t, "{")) depth++;
      if (this.isPunct(t, ")") || this.isPunct(t, "]") || this.isPunct(t, "}")) {
        if (depth === 0) return out;
        depth--;
      }
      // Stop at keywords that cannot be inside a port list (recovery for "module m(input a, output").
      if (this.isIdent(t) && (t.text === "assign" || t.text === "endmodule" || t.text === "always" || t.text === "module")) {
        if (depth === 0) return out;
      }
      out.push(t);
      this.i++;
    }
    return out;
  }

  private addPort(p: SPort): void {
    const prev = this.ports.find((q) => q.name === p.name);
    if (prev) {
      prev.direction = p.direction;
      prev.width = p.width;
      if (p.range !== undefined) prev.range = p.range;
      prev.src = p.src;
    } else {
      this.ports.push(p);
    }
  }

  private parsePortList(): void {
    const open = this.next();
    const inner = this.collectUntilClose();
    if (this.isPunct(this.peek(), ")")) this.next();
    else this.error(open, "unclosed port list");
    // Split at depth-0 commas.
    const groups: Tok[][] = [[]];
    let depth = 0;
    for (const t of inner) {
      if (this.isPunct(t, "(") || this.isPunct(t, "[") || this.isPunct(t, "{")) depth++;
      if (this.isPunct(t, ")") || this.isPunct(t, "]") || this.isPunct(t, "}")) depth--;
      if (this.isPunct(t, ",") && depth === 0) groups.push([]);
      else groups[groups.length - 1]?.push(t);
    }
    let dir: PortDirection = "input";
    let range: string | undefined;
    let ansi = false;
    for (const g of groups) {
      if (g.length === 0) continue;
      let j = 0;
      const first = g[0];
      const d = first && first.kind === "ident" ? DIRECTIONS[first.text] : undefined;
      if (d) {
        dir = d;
        range = undefined;
        ansi = true;
        j++;
      }
      // Skip net type / data type keywords.
      while (j < g.length && this.isIdent(g[j]) && ["wire", "reg", "logic", "signed", "unsigned", "var"].includes(g[j]?.text ?? "")) j++;
      // Packed dimension.
      if (this.isPunct(g[j], "[")) {
        const startTok = g[j];
        let depthB = 0;
        let k = j;
        for (; k < g.length; k++) {
          if (this.isPunct(g[k], "[")) depthB++;
          if (this.isPunct(g[k], "]")) {
            depthB--;
            if (depthB === 0) break;
          }
        }
        range = this.textBetween(startTok, g[k]);
        j = k + 1;
      }
      const nameTok = g[j];
      if (!this.isIdent(nameTok)) {
        // "output" with nothing after it (partial header): remember direction, no port.
        if (d) this.hasErrors = true;
        continue;
      }
      const r = parseRange(range);
      const src = this.rangeOfToks(g[0], g[g.length - 1]);
      if (ansi) {
        this.addPort({ name: nameTok?.text ?? "", direction: dir, width: r ? r.width : 1, ...(r ? { range: r.range } : {}), src });
      } else {
        this.addPort({ name: nameTok?.text ?? "", direction: "input", width: 1, src });
      }
    }
  }

  private statementTokens(): Tok[] {
    const out: Tok[] = [];
    while (this.i < this.toks.length) {
      const t = this.peek();
      if (!t) break;
      if (this.isPunct(t, ";")) {
        this.next();
        return out;
      }
      if (this.isIdent(t) && ITEM_KEYWORDS.has(t.text) && out.length > 0) {
        this.error(t, "missing ;");
        return out;
      }
      out.push(t);
      this.i++;
    }
    return out;
  }

  private parseItem(): void {
    const t = this.peek();
    if (!t) return;
    if (this.isIdent(t)) {
      switch (t.text) {
        case "input":
        case "output":
        case "inout":
          this.parsePortDecl();
          return;
        case "wire":
        case "reg":
        case "logic":
          this.parseDecl();
          return;
        case "assign":
          this.parseAssign();
          return;
        case "always":
        case "always_comb":
        case "always_ff":
        case "always_latch":
          this.parseAlways();
          return;
        case "localparam":
        case "parameter":
          this.parseParam();
          return;
        case "integer":
        case "genvar":
        case "initial":
        case "generate":
        case "function":
        case "task":
          this.statementTokens();
          return;
        default:
          if (this.looksLikeInstance()) {
            this.parseInstance();
            return;
          }
          break;
      }
    }
    this.error(t, `unexpected ${t.text}`);
    this.statementTokens();
  }

  private looksLikeInstance(): boolean {
    const a = this.peek();
    let k = 1;
    if (this.isPunct(this.peek(1), "#")) {
      // parameter override: skip balanced parens in lookahead
      let depth = 0;
      k = 2;
      for (; this.i + k < this.toks.length; k++) {
        const t = this.peek(k);
        if (this.isPunct(t, "(")) depth++;
        if (this.isPunct(t, ")")) {
          depth--;
          if (depth === 0) {
            k++;
            break;
          }
        }
      }
    }
    return this.isIdent(a) && this.isIdent(this.peek(k)) && this.isPunct(this.peek(k + 1), "(");
  }

  private parseDimAndNames(toks: Tok[], from: number): { range: string | undefined; names: { name: string; src: SrcRange; init?: Tok[] }[] } {
    let j = from;
    while (j < toks.length && this.isIdent(toks[j]) && ["wire", "reg", "logic", "signed", "unsigned", "var"].includes(toks[j]?.text ?? "")) j++;
    let range: string | undefined;
    if (this.isPunct(toks[j], "[")) {
      const start = toks[j];
      let depth = 0;
      let k = j;
      for (; k < toks.length; k++) {
        if (this.isPunct(toks[k], "[")) depth++;
        if (this.isPunct(toks[k], "]")) {
          depth--;
          if (depth === 0) break;
        }
      }
      range = this.textBetween(start, toks[k]);
      j = k + 1;
    }
    const names: { name: string; src: SrcRange; init?: Tok[] }[] = [];
    const parts: Tok[][] = [[]];
    let depth = 0;
    for (let k = j; k < toks.length; k++) {
      const t = toks[k];
      if (!t) continue;
      if (this.isPunct(t, "(") || this.isPunct(t, "[") || this.isPunct(t, "{")) depth++;
      if (this.isPunct(t, ")") || this.isPunct(t, "]") || this.isPunct(t, "}")) depth--;
      if (this.isPunct(t, ",") && depth === 0) parts.push([]);
      else parts[parts.length - 1]?.push(t);
    }
    for (const p of parts) {
      const nameTok = p[0];
      if (!this.isIdent(nameTok)) continue;
      const eq = p.findIndex((t) => this.isPunct(t, "="));
      const entry: { name: string; src: SrcRange; init?: Tok[] } = { name: nameTok?.text ?? "", src: this.rangeOfToks(p[0], p[p.length - 1]) };
      if (eq >= 0) entry.init = p.slice(eq + 1);
      names.push(entry);
    }
    return { range, names };
  }

  private parsePortDecl(): void {
    const toks = this.statementTokens();
    const dirTok = toks[0];
    const dir = dirTok ? DIRECTIONS[dirTok.text] : undefined;
    if (!dir) return;
    const { range, names } = this.parseDimAndNames(toks, 1);
    const r = parseRange(range);
    const src = this.rangeOfToks(toks[0], toks[toks.length - 1]);
    for (const n of names) {
      this.addPort({ name: n.name, direction: dir, width: r ? r.width : 1, ...(r ? { range: r.range } : {}), src });
    }
  }

  private parseDecl(): void {
    const toks = this.statementTokens();
    const kindTok = toks[0];
    const kind = kindTok?.text === "wire" ? "wire" : kindTok?.text === "reg" ? "reg" : kindTok?.text === "logic" ? "logic" : "other";
    const { range, names } = this.parseDimAndNames(toks, 1);
    const r = parseRange(range);
    for (const n of names) {
      this.decls.push({ name: n.name, kind, width: r ? r.width : 1, ...(r ? { range: r.range } : {}), src: n.src });
      if (n.init && n.init.length > 0) {
        const rhsText = this.textBetween(n.init[0], n.init[n.init.length - 1]);
        this.assigns.push({ lhs: [n.name], rhs: uniq(extractIdentifiers(rhsText)), lhsText: n.name, rhsText, src: n.src });
      }
    }
  }

  private parseAssign(): void {
    const toks = this.statementTokens();
    const body = toks.slice(1);
    if (body.length === 0) return;
    // Possibly several comma-separated assignments; split at depth 0.
    const parts: Tok[][] = [[]];
    let depth = 0;
    for (const t of body) {
      if (this.isPunct(t, "(") || this.isPunct(t, "[") || this.isPunct(t, "{")) depth++;
      if (this.isPunct(t, ")") || this.isPunct(t, "]") || this.isPunct(t, "}")) depth--;
      if (this.isPunct(t, ",") && depth === 0) parts.push([]);
      else parts[parts.length - 1]?.push(t);
    }
    for (const p of parts) {
      const eq = p.findIndex((t) => this.isPunct(t, "="));
      if (eq < 0) {
        this.error(p[0], "assign without =");
        continue;
      }
      const lhsToks = p.slice(0, eq);
      const rhsToks = p.slice(eq + 1);
      const lhsText = this.textBetween(lhsToks[0], lhsToks[lhsToks.length - 1]);
      const rhsText = this.textBetween(rhsToks[0], rhsToks[rhsToks.length - 1]);
      if (rhsToks.length === 0) this.hasErrors = true;
      this.assigns.push({
        lhs: uniq(extractIdentifiers(lhsText)),
        rhs: uniq(extractIdentifiers(rhsText)),
        lhsText,
        rhsText,
        src: this.rangeOfToks(toks[0], p[p.length - 1]),
      });
    }
  }

  private parseAlways(): void {
    const start = this.next();
    // Sensitivity: @ ( ... ) or @*
    if (this.isPunct(this.peek(), "@")) {
      this.next();
      if (this.isPunct(this.peek(), "(")) this.skipBalanced("(", ")");
      else if (this.isPunct(this.peek(), "*")) this.next();
    }
    const end = this.parseStatement();
    const text = this.textBetween(start, end ?? start);
    this.always.push(analyzeAlwaysText(text, this.rangeOfToks(start, end ?? start)));
  }

  /** Consume one statement (begin/end block, if/else, case, or simple ;-terminated). Returns last token. */
  private parseStatement(): Tok | undefined {
    const t = this.peek();
    if (!t) return undefined;
    if (this.isIdent(t, "begin")) {
      this.next();
      if (this.isPunct(this.peek(), ":")) {
        this.next();
        this.next();
      }
      let last: Tok | undefined = t;
      while (this.i < this.toks.length) {
        const u = this.peek();
        if (!u) break;
        if (this.isIdent(u, "end")) {
          last = this.next();
          if (this.isPunct(this.peek(), ":")) {
            this.next();
            this.next();
          }
          return last;
        }
        if (this.isIdent(u, "endmodule") || this.isIdent(u, "always") || this.isIdent(u, "assign") || this.isIdent(u, "module")) {
          this.error(u, "unclosed begin");
          return last;
        }
        const before = this.i;
        last = this.parseStatement() ?? last;
        if (this.i === before) this.next();
      }
      this.error(undefined, "unclosed begin");
      return last;
    }
    if (this.isIdent(t, "if")) {
      this.next();
      this.skipBalanced("(", ")");
      let last = this.parseStatement();
      if (this.isIdent(this.peek(), "else")) {
        this.next();
        last = this.parseStatement() ?? last;
      }
      return last;
    }
    if (this.isIdent(t, "case") || this.isIdent(t, "casez") || this.isIdent(t, "casex")) {
      this.next();
      this.skipBalanced("(", ")");
      let last: Tok | undefined = t;
      while (this.i < this.toks.length) {
        const u = this.peek();
        if (!u) break;
        if (this.isIdent(u, "endcase")) return this.next();
        if (this.isIdent(u, "endmodule") || this.isIdent(u, "always") || this.isIdent(u, "assign")) {
          this.error(u, "unclosed case");
          return last;
        }
        // case item: expr(s) : statement
        let depth = 0;
        while (this.i < this.toks.length) {
          const v = this.peek();
          if (!v) break;
          if (this.isPunct(v, "(") || this.isPunct(v, "[") || this.isPunct(v, "{")) depth++;
          if (this.isPunct(v, ")") || this.isPunct(v, "]") || this.isPunct(v, "}")) depth--;
          this.next();
          if (this.isPunct(v, ":") && depth === 0) break;
          if (this.isIdent(v, "endcase") || this.isIdent(v, "endmodule")) {
            this.i--;
            break;
          }
        }
        const before = this.i;
        last = this.parseStatement() ?? last;
        if (this.i === before) this.next();
      }
      this.error(undefined, "unclosed case");
      return last;
    }
    if (this.isIdent(t, "for") || this.isIdent(t, "while")) {
      this.next();
      this.skipBalanced("(", ")");
      return this.parseStatement();
    }
    if (this.isPunct(t, ";")) return this.next();
    // Simple statement up to ;
    let last: Tok | undefined;
    while (this.i < this.toks.length) {
      const u = this.peek();
      if (!u) break;
      if (this.isPunct(u, ";")) return this.next();
      if (this.isIdent(u) && (u.text === "end" || u.text === "endcase" || u.text === "endmodule" || u.text === "else" || u.text === "begin" || u.text === "if" || u.text === "case" || u.text === "always" || u.text === "assign")) {
        this.error(u, "missing ;");
        return last;
      }
      last = this.next();
    }
    return last;
  }

  private parseParam(): void {
    const toks = this.statementTokens();
    const { names } = this.parseDimAndNames(toks, 1);
    for (const n of names) {
      const valueText = n.init ? this.textBetween(n.init[0], n.init[n.init.length - 1]) : "";
      this.localparams.push({ name: n.name, valueText, src: n.src });
    }
  }

  private parseInstance(): void {
    const typeTok = this.next();
    if (this.isPunct(this.peek(), "#")) {
      this.next();
      this.skipBalanced("(", ")");
    }
    const nameTok = this.next();
    const open = this.next();
    const inner = this.collectUntilClose();
    let last: Tok | undefined = inner[inner.length - 1] ?? open;
    if (this.isPunct(this.peek(), ")")) last = this.next();
    else this.error(open, "unclosed instance port list");
    if (this.isPunct(this.peek(), ";")) last = this.next();
    const innerText = inner.length > 0 ? this.textBetween(inner[0], inner[inner.length - 1]) : "";
    const base = inner[0]?.start ?? open?.end ?? 0;
    const connections: SConnection[] = parseConnectionText(innerText, base).map((c) => ({
      ...(c.port !== undefined ? { port: c.port } : {}),
      index: c.index,
      exprText: c.exprText,
      idents: c.idents,
      isConst: c.isConst,
      src: this.lines.range(c.start, c.end),
    }));
    this.instances.push({
      moduleType: typeTok?.text ?? "",
      name: nameTok?.text ?? "",
      connections,
      src: this.rangeOfToks(typeTok, last),
    });
  }
}
