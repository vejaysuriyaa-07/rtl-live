// Structural parser on top of web-tree-sitter + tree-sitter-verilog.
//
// Strategy: instead of pattern matching the deep CST shape (which breaks under
// ERROR nodes), collect every node of interest anywhere in the tree, in document
// order, and assign each to the module whose span contains it. Module spans run
// from a module_header to its endmodule, the next module_header, or EOF.
import type { Node as TsNode, Parser, Tree } from "web-tree-sitter";
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
import { refineErrors, tokenize } from "./errorMessages";
import { uniq, extractIdentifiers, analyzeAlwaysText, LineIndex, parseConnectionText } from "./textUtils";

function rangeOf(n: TsNode): SrcRange {
  return {
    line: n.startPosition.row + 1,
    column: n.startPosition.column + 1,
    endLine: n.endPosition.row + 1,
    endColumn: n.endPosition.column + 1,
  };
}

function* walk(root: TsNode): Generator<TsNode> {
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n) break;
    yield n;
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i);
      if (c) stack.push(c);
    }
  }
}

function firstOfType(n: TsNode, type: string): TsNode | undefined {
  for (const d of walk(n)) if (d.type === type) return d;
  return undefined;
}

function allOfType(n: TsNode, type: string): TsNode[] {
  const out: TsNode[] = [];
  for (const d of walk(n)) if (d.type === type) out.push(d);
  return out;
}

function directChildOfType(n: TsNode, type: string): TsNode | undefined {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (c && c.type === type) return c;
  }
  return undefined;
}

function identName(n: TsNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === "simple_identifier" || n.type === "escaped_identifier") return n.text;
  const id = firstOfType(n, "simple_identifier") ?? firstOfType(n, "escaped_identifier");
  return id?.text;
}

function directionOf(text: string): PortDirection | undefined {
  if (text === "input") return "input";
  if (text === "output") return "output";
  if (text === "inout") return "inout";
  return undefined;
}

function packedDimText(n: TsNode): string | undefined {
  const pd = firstOfType(n, "packed_dimension");
  return pd?.text;
}

interface ModuleSpan {
  name: string;
  start: number;
  end: number;
  headerNode: TsNode;
  declNode: TsNode | undefined;
  hasErrors: boolean;
}

export class TreeSitterStructuralParser implements StructuralParser {
  readonly name = "tree-sitter" as const;
  private tree: Tree | undefined;
  private lines: LineIndex = new LineIndex("");

  constructor(private readonly parser: Parser) {}

  parse(text: string): StructuralFile {
    // Full reparse each time; incremental edits are not worth the bookkeeping at HDLBits sizes.
    this.tree?.delete();
    const tree = this.parser.parse(text);
    if (!tree) {
      return { modules: [], errors: [{ line: 1, column: 1, message: "parser returned no tree" }], hasErrors: true, parser: "tree-sitter" };
    }
    this.tree = tree;
    this.lines = new LineIndex(text);
    const root = tree.rootNode;
    const spans = this.moduleSpans(root, text.length);
    const extra: SError[] = [];
    const typedefs = new Set([...text.matchAll(/\btypedef\b[^;]*?([A-Za-z_][\w$]*)\s*;/g)].map((m) => m[1] ?? ""));
    const modules = spans.map((s) => this.buildModule(root, s, text, typedefs, extra));
    const merged = refineErrors(text, [...collectErrors(root), ...extra]).sort((a, b) => a.line - b.line || a.column - b.column);
    const errors = merged.filter((e, i) => !merged.slice(0, i).some((o) => o.line === e.line && o.column === e.column && o.message === e.message));
    return { modules, errors, hasErrors: hasRealError(root) || extra.length > 0, parser: "tree-sitter" };
  }

  private moduleSpans(root: TsNode, textLength: number): ModuleSpan[] {
    const headers = allOfType(root, "module_header").sort((a, b) => a.startIndex - b.startIndex);
    const decls = allOfType(root, "module_declaration");
    const endmodules: TsNode[] = [];
    for (const n of walk(root)) if (!n.isNamed && n.type === "endmodule") endmodules.push(n);
    endmodules.sort((a, b) => a.startIndex - b.startIndex);
    const spans: ModuleSpan[] = [];
    headers.forEach((h, i) => {
      const name = identName(h) ?? "";
      const next = headers[i + 1];
      const hardEnd = next ? next.startIndex : textLength;
      const em = endmodules.find((e) => e.startIndex > h.startIndex && e.startIndex < hardEnd);
      const end = em ? em.endIndex : hardEnd;
      const decl = decls.find((d) => d.startIndex <= h.startIndex && d.endIndex >= h.endIndex);
      const hasErrors = decl ? hasRealError(decl) : true;
      spans.push({ name, start: h.startIndex, end, headerNode: h, declNode: decl, hasErrors });
    });
    return spans;
  }

  private buildModule(root: TsNode, span: ModuleSpan, text: string, typedefs: Set<string>, errors: SError[]): SModule {
    const inSpan = (n: TsNode): boolean => n.startIndex >= span.start && n.endIndex <= span.end;
    const nodes: TsNode[] = [];
    for (const n of walk(root)) if (inSpan(n)) nodes.push(n);

    const before = errors.length;
    const ports = extractPorts(nodes, span, typedefs, errors);
    const swallowed = errors.length > before;
    if (span.hasErrors || swallowed) {
      // The tree loses ports near the break ("output b" at the end of an unclosed list);
      // read the header text itself and add what the tree missed, greyed out.
      const seen = new Set(ports.map((p) => p.name));
      for (const r of recoverHeaderPorts(text, span.start, span.end, this.lines)) {
        if (seen.has(r.name)) continue;
        seen.add(r.name);
        ports.push(r);
      }
      // Recovered ports carry their own position; keep the list in text order.
      ports.sort((a, b) => a.src.line - b.src.line || a.src.column - b.src.column);
    }
    const decls = extractDecls(nodes);
    const assigns = extractAssigns(nodes, decls);
    const always = extractAlways(nodes, this.lines);
    const instances = extractInstances(nodes, this.lines);
    const localparams = extractParams(nodes);
    const hasErrors = span.hasErrors || swallowed || nodes.some((n) => n.type === "ERROR" || (n.isMissing && !isGrammarQuirkMissing(n)));
    const src: SrcRange = span.declNode
      ? rangeOf(span.declNode)
      : {
          line: span.headerNode.startPosition.row + 1,
          column: span.headerNode.startPosition.column + 1,
          endLine: span.headerNode.endPosition.row + 1,
          endColumn: span.headerNode.endPosition.column + 1,
        };
    return { name: span.name, ports, decls, assigns, always, instances, localparams, hasErrors, src };
  }
}

// tree-sitter-verilog 1.0.0 inserts a MISSING "++"/"--" after an identifier named
// like a keyword prefix (e.g. "in") when it is the last element of a concatenation.
// The tree is otherwise complete, so these are not treated as errors.
function isGrammarQuirkMissing(n: TsNode): boolean {
  return n.type === "++" || n.type === "--";
}

function hasRealError(n: TsNode): boolean {
  if (!n.hasError) return false;
  for (const d of walk(n)) {
    if (d.type === "ERROR") return true;
    if (d.isMissing && !isGrammarQuirkMissing(d)) return true;
  }
  return false;
}

function collectErrors(root: TsNode): SError[] {
  const out: SError[] = [];
  for (const n of walk(root)) {
    if (n.type === "ERROR") {
      out.push({ line: n.startPosition.row + 1, column: n.startPosition.column + 1, message: "syntax error" });
    } else if (n.isMissing && !isGrammarQuirkMissing(n)) {
      out.push({ line: n.startPosition.row + 1, column: n.startPosition.column + 1, message: `missing ${n.type}` });
    }
    if (out.length >= 50) break;
  }
  return out;
}

/** A node inside, or containing, a syntax error: what it yields is tentative. */
function inErrorContext(n: TsNode): boolean {
  for (let p: TsNode | null = n; p; p = p.parent) if (p.type === "ERROR") return true;
  return n.hasError;
}

const RESERVED = new Set(["assign", "always", "always_comb", "always_ff", "initial", "wire", "reg", "logic", "input", "output", "inout", "module", "endmodule", "begin", "end", "if", "else", "case", "endcase", "localparam", "parameter", "signed", "unsigned"]);

/**
 * Inside a broken header tree-sitter may attach the next statement's keyword to a
 * port ("output b\n assign b = a" yields a port named "assign"). Read the name from
 * the declaration text instead: the first identifier after the direction and type words.
 */
function recoveredPortName(declText: string): string | undefined {
  const m = /^\s*(?:input|output|inout)?\s*(?:wire|reg|logic|var|signed|unsigned|\s)*(?:\[[^\]]*\]\s*)*([A-Za-z_][\w$]*)/.exec(declText);
  const name = m?.[1];
  return name && !RESERVED.has(name) ? name : undefined;
}

const HEADER_STOP = new Set(["assign", "always", "always_comb", "always_ff", "initial", "wire", "reg", "logic", "localparam", "parameter", "endmodule", "module"]);

/**
 * Port list read from the text between "module name(" and the closing ")" (or the first
 * statement keyword when the list never closes). Direction and range carry over items.
 */
export function recoverHeaderPorts(text: string, start: number, end: number, lines: LineIndex): SPort[] {
  const toks = tokenize(text.slice(start, end)).map((t) => ({ ...t, start: t.start + start, end: t.end + start }));
  let i = toks.findIndex((t) => t.text === "module");
  if (i < 0 || !toks[i + 1] || toks[i + 2]?.text !== "(") return [];
  i += 3;
  const out: SPort[] = [];
  let dir: PortDirection = "input";
  let range: string | undefined;
  let depth = 0;
  let itemStart = i;
  const flush = (from: number, to: number): void => {
    let itemRange: string | undefined;
    let name: string | undefined;
    let nameTok: { start: number; end: number } | undefined;
    for (let k = from; k < to; k++) {
      const t = toks[k]!;
      const d = directionOf(t.text);
      if (d) {
        dir = d;
        range = undefined;
        continue;
      }
      if (t.text === "[") {
        let j = k;
        while (j < to && toks[j]!.text !== "]") j++;
        itemRange = text.slice(t.start, (toks[j] ?? t).end);
        k = j;
        continue;
      }
      if (/^[A-Za-z_$][\w$]*$/.test(t.text) && !RESERVED.has(t.text) && !["wire", "reg", "logic", "var", "signed", "unsigned", "tri"].includes(t.text)) {
        name = t.text;
        nameTok = t;
      }
    }
    if (itemRange !== undefined) range = itemRange;
    if (!name || !nameTok) return;
    const r = parseRange(range);
    out.push({ name, direction: dir, width: r ? r.width : 1, ...(r ? { range: r.range } : {}), src: lines.range(nameTok.start, nameTok.end), tentative: true });
  };
  for (; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.text === "(" || t.text === "[" || t.text === "{") depth++;
    else if (t.text === ")" || t.text === "]" || t.text === "}") {
      if (depth === 0) {
        flush(itemStart, i);
        return out;
      }
      depth--;
    } else if (depth === 0 && t.text === ",") {
      flush(itemStart, i);
      itemStart = i + 1;
    } else if (depth === 0 && (t.text === ";" || HEADER_STOP.has(t.text))) {
      flush(itemStart, i);
      return out;
    }
  }
  flush(itemStart, toks.length);
  return out;
}

const TYPE_WORDS = new Set(["wire", "reg", "logic", "bit", "byte", "int", "integer", "shortint", "longint", "tri", "tri0", "tri1", "wand", "wor", "supply0", "supply1", "signed", "unsigned", "var", "real", "time"]);

/** Identifiers that sit in the type position of an ANSI port declaration ("input p1c p1d": p1c). */
function swallowedPortNames(decl: TsNode): { name: string; node: TsNode }[] {
  const out: { name: string; node: TsNode }[] = [];
  const header = directChildOfType(decl, "net_port_header1") ?? directChildOfType(decl, "variable_port_header");
  if (!header) return out;
  for (const n of walk(header)) {
    if (n.type !== "simple_identifier") continue;
    let inDimension = false;
    for (let p: TsNode | null = n.parent; p && p !== header; p = p.parent) {
      if (p.type.includes("dimension") || p.type.includes("range") || p.type === "port_identifier") inDimension = true;
    }
    if (inDimension) continue;
    const name = n.text;
    if (RESERVED.has(name) || TYPE_WORDS.has(name)) continue;
    out.push({ name, node: n });
  }
  return out;
}

function extractPorts(nodes: TsNode[], span: ModuleSpan, typedefs: Set<string>, errors: SError[]): SPort[] {
  const ports: SPort[] = [];
  const seen = new Map<string, SPort>();
  const push = (p: SPort): void => {
    const prev = seen.get(p.name);
    if (prev) {
      // Non-ANSI: list_of_ports gave the name; the declaration gives direction and width.
      prev.direction = p.direction;
      prev.width = p.width;
      if (p.range !== undefined) prev.range = p.range;
      prev.src = p.src;
      return;
    }
    seen.set(p.name, p);
    ports.push(p);
  };

  // ANSI ports: ansi_port_declaration nodes (also found loose under ERROR).
  let lastDir: PortDirection = "input";
  let lastRange: string | undefined;
  const ansi = nodes.filter((n) => n.type === "ansi_port_declaration");
  for (const a of ansi) {
    const dirNode = firstOfType(a, "port_direction");
    const dir = dirNode ? directionOf(dirNode.text) : undefined;
    const dim = packedDimText(a);
    if (dir) {
      lastDir = dir;
      lastRange = dim;
    } else if (dim !== undefined) {
      lastRange = dim;
    }
    const broken = inErrorContext(a);
    const treeName = identName(directChildOfType(a, "port_identifier") ?? firstOfType(a, "port_identifier"));
    const r = parseRange(lastRange);
    // A missing comma makes tree-sitter read "p1c p1d" as type p1c, port p1d. An identifier
    // in the type position that is not a typedef of this file is a port whose comma is missing.
    const swallowed = broken ? [] : swallowedPortNames(a).filter((x) => !typedefs.has(x.name));
    const portIdent = directChildOfType(a, "port_identifier") ?? firstOfType(a, "port_identifier");
    for (const x of swallowed) {
      push({ name: x.name, direction: lastDir, width: r ? r.width : 1, ...(r ? { range: r.range } : {}), src: rangeOf(x.node), tentative: true });
      const at = portIdent ?? x.node;
      errors.push({ line: at.startPosition.row + 1, column: at.startPosition.column + 1, message: `missing ',' before '${portIdent ? portIdent.text : x.name}'` });
    }
    const name = broken ? (recoveredPortName(a.text) ?? (treeName && !RESERVED.has(treeName) ? treeName : undefined)) : treeName && !RESERVED.has(treeName) ? treeName : undefined;
    if (!name) continue;
    push({ name, direction: lastDir, width: r ? r.width : 1, ...(r ? { range: r.range } : {}), src: rangeOf(a), ...(broken || swallowed.length > 0 ? { tentative: true } : {}) });
  }

  // Header fragments under ERROR: a dangling "output" with no identifier is ignored,
  // but "input a" that tree-sitter split into net_port_header1 + port_identifier siblings is caught here.
  if (ansi.length === 0) {
    const header = span.headerNode.parent ?? span.headerNode;
    const fragments = nodes.filter(
      (n) => (n.type === "net_port_header1" || n.type === "variable_port_header") && n.parent === header,
    );
    for (const f of fragments) {
      const dirNode = firstOfType(f, "port_direction");
      const dir = dirNode ? directionOf(dirNode.text) : undefined;
      if (dir) lastDir = dir;
      const r = parseRange(packedDimText(f));
      const sib = f.nextNamedSibling;
      if (sib && sib.type === "port_identifier") {
        const name = identName(sib);
        if (name) push({ name, direction: lastDir, width: r ? r.width : 1, ...(r ? { range: r.range } : {}), src: rangeOf(f), tentative: true });
      }
    }
  }

  // Non-ANSI: list_of_ports names, then port_declaration items.
  for (const lop of nodes.filter((n) => n.type === "list_of_ports")) {
    for (const p of allOfType(lop, "port")) {
      const name = identName(firstOfType(p, "port_identifier"));
      if (name) push({ name, direction: "input", width: 1, src: rangeOf(p) });
    }
  }
  for (const pd of nodes.filter((n) => n.type === "port_declaration")) {
    const inner = pd.namedChildren[0];
    if (!inner) continue;
    const dir = directionOf(inner.type.replace("_declaration", ""));
    if (!dir) continue;
    const r = parseRange(packedDimText(inner));
    for (const id of allOfType(inner, "port_identifier")) {
      const name = identName(id);
      if (name) push({ name, direction: dir, width: r ? r.width : 1, ...(r ? { range: r.range } : {}), src: rangeOf(pd) });
    }
  }
  return ports;
}

function extractDecls(nodes: TsNode[]): SDecl[] {
  const out: SDecl[] = [];
  for (const n of nodes) {
    if (n.type === "net_declaration") {
      const r = parseRange(packedDimText(n));
      for (const d of allOfType(n, "net_decl_assignment")) {
        const name = identName(d);
        if (name) out.push({ name, kind: "wire", width: r ? r.width : 1, ...(r ? { range: r.range } : {}), src: rangeOf(d) });
      }
    } else if (n.type === "data_declaration") {
      const dt = firstOfType(n, "data_type");
      const typeText = dt ? (firstOfType(dt, "integer_vector_type")?.text ?? "") : "";
      const kind = typeText === "reg" ? "reg" : typeText === "logic" ? "logic" : "other";
      const r = parseRange(dt ? packedDimText(dt) : undefined);
      for (const d of allOfType(n, "variable_decl_assignment")) {
        const name = identName(d);
        if (name) out.push({ name, kind, width: r ? r.width : 1, ...(r ? { range: r.range } : {}), src: rangeOf(d) });
      }
    }
  }
  return out;
}

function extractAssigns(nodes: TsNode[], decls: SDecl[]): SAssign[] {
  const out: SAssign[] = [];
  for (const n of nodes) {
    if (n.type === "net_assignment" || n.type === "variable_assignment") {
      const lhsNode = n.namedChildren[0];
      const rhsNode = n.namedChildren[1];
      if (!lhsNode) continue;
      const lhs = uniq(extractIdentifiers(lhsNode.text));
      const rhsText = rhsNode?.text ?? "";
      out.push({ lhs, rhs: uniq(extractIdentifiers(rhsText)), lhsText: lhsNode.text, rhsText, src: rangeOf(n) });
    }
  }
  // Declaration assignments: wire x = a & b;
  for (const n of nodes) {
    if (n.type === "net_decl_assignment" && n.namedChildCount >= 2) {
      const name = identName(n);
      const expr = n.namedChildren.find((c) => c.type === "expression");
      if (name && expr) {
        out.push({ lhs: [name], rhs: uniq(extractIdentifiers(expr.text)), lhsText: name, rhsText: expr.text, src: rangeOf(n) });
      }
    }
  }
  // A broken "assign out = a &" shows up as loose tokens under ERROR; recover by text.
  for (const n of nodes) {
    if (!n.isNamed && n.type === "assign" && n.parent && n.parent.type === "ERROR") {
      const parent = n.parent;
      const after = parent.text.slice(n.endIndex - parent.startIndex);
      const m = /^\s*([A-Za-z_][\w$]*(?:\s*\[[^\]]*\])?)\s*=\s*([^;]*)/.exec(after);
      if (m && m[1] !== undefined) {
        const lhsText = m[1];
        const rhsText = (m[2] ?? "").split(/\b(?:assign|always|endmodule|module|wire|reg)\b/)[0] ?? "";
        const already = out.some((a) => a.src.line === n.startPosition.row + 1);
        if (!already) {
          out.push({
            lhs: uniq(extractIdentifiers(lhsText)),
            rhs: uniq(extractIdentifiers(rhsText)),
            lhsText,
            rhsText: rhsText.trim(),
            src: rangeOf(n),
          });
        }
      }
    }
  }
  void decls;
  return out;
}

function extractAlways(nodes: TsNode[], lines: LineIndex): SAlways[] {
  const out: SAlways[] = [];
  const seenStarts = new Set<number>();
  for (const n of nodes) {
    if (n.type === "always_construct") {
      seenStarts.add(n.startIndex);
      out.push(analyzeAlwaysText(n.text, rangeOf(n)));
    }
  }
  // Unclosed always under ERROR: an always_keyword whose parent is not an always_construct.
  for (const n of nodes) {
    if (n.type === "always_keyword" && n.parent && n.parent.type !== "always_construct" && !seenStarts.has(n.startIndex)) {
      const parent = n.parent;
      const rest = parent.text.slice(n.startIndex - parent.startIndex);
      const text = rest.split(/\bendmodule\b/)[0] ?? rest;
      out.push(analyzeAlwaysText(text, lines.range(n.startIndex, n.startIndex + text.length)));
    }
  }
  return out;
}

const INSTANTIATION_TYPES = new Set(["module_instantiation", "udp_instantiation", "checker_instantiation", "interface_instantiation"]);
const INSTANCE_TYPES = new Set(["hierarchical_instance", "udp_instance"]);
const NOT_INSTANCE_TYPES = new Set(["module", "assign", "always", "wire", "reg", "logic", "input", "output", "inout", "localparam", "parameter", "initial", "endmodule"]);

function connectionsFromText(src: string, baseOffset: number, lines: LineIndex): SConnection[] {
  return parseConnectionText(src, baseOffset).map((c) => ({
    ...(c.port !== undefined ? { port: c.port } : {}),
    index: c.index,
    exprText: c.exprText,
    idents: c.idents,
    isConst: c.isConst,
    src: lines.range(c.start, c.end),
  }));
}

/** Connections of an instance node: text between the "(" after the instance name and its matching ")". */
function instanceConnections(instNode: TsNode, nameEnd: number, lines: LineIndex): SConnection[] {
  const text = instNode.text;
  const rel = nameEnd - instNode.startIndex;
  const open = text.indexOf("(", rel);
  if (open < 0) return [];
  let depth = 0;
  let close = text.length;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  return connectionsFromText(text.slice(open + 1, close), instNode.startIndex + open + 1, lines);
}

function extractInstances(nodes: TsNode[], lines: LineIndex): SInstance[] {
  const out: SInstance[] = [];
  for (const n of nodes) {
    if (!INSTANTIATION_TYPES.has(n.type)) continue;
    const typeNode = n.namedChildren.find(
      (c) => c.type === "simple_identifier" || c.type === "escaped_identifier" || c.type === "checker_identifier" || c.type === "interface_identifier",
    );
    const moduleType = identName(typeNode) ?? "";
    const instNodes = n.namedChildren.filter((c) => INSTANCE_TYPES.has(c.type));
    if (instNodes.length === 0) {
      // checker_instantiation: name_of_instance and connections are direct children
      const nameNode = n.namedChildren.find((c) => c.type === "name_of_instance");
      if (!nameNode) continue;
      out.push({ moduleType, name: identName(nameNode) ?? "", connections: instanceConnections(n, nameNode.endIndex, lines), src: rangeOf(n) });
      continue;
    }
    for (const inst of instNodes) {
      const nameNode = firstOfType(inst, "name_of_instance");
      const name = identName(nameNode) ?? "";
      out.push({ moduleType, name, connections: instanceConnections(inst, nameNode ? nameNode.endIndex : inst.startIndex, lines), src: rangeOf(n) });
    }
  }
  // Broken instance under ERROR: "mod_a u1(.in1(a), .in2(" leaves loose tokens.
  for (const n of nodes) {
    if (n.type !== "ERROR") continue;
    const m = /^\s*([A-Za-z_][\w$]*)\s+([A-Za-z_][\w$]*)\s*\(([\s\S]*)$/.exec(n.text);
    if (!m || !m[1] || !m[2] || NOT_INSTANCE_TYPES.has(m[1])) continue;
    const moduleType = m[1];
    const name = m[2];
    if (out.some((i) => i.name === name)) continue;
    const open = n.text.indexOf("(");
    const inner = (m[3] ?? "").split(/\b(?:endmodule|assign|always|module)\b/)[0] ?? "";
    out.push({ moduleType, name, connections: connectionsFromText(inner, n.startIndex + open + 1, lines), src: rangeOf(n) });
  }
  return out;
}

function extractParams(nodes: TsNode[]): SParam[] {
  const out: SParam[] = [];
  for (const n of nodes) {
    if (n.type === "local_parameter_declaration" || n.type === "parameter_declaration") {
      for (const pa of allOfType(n, "param_assignment")) {
        const name = identName(firstOfType(pa, "parameter_identifier"));
        const val = pa.namedChildren.find((c) => c.type === "constant_param_expression");
        if (name) out.push({ name, valueText: val?.text ?? "", src: rangeOf(pa) });
      }
    }
  }
  return out;
}
