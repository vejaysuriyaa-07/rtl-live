// Generates (* blackbox *) stubs for instantiated-but-undefined module types so
// Yosys can elaborate HDLBits designs that rely on provided modules (mod_a, my_dff, add16).
import type { SConnection, SModule, StructuralFile } from "../structural/types";
import { literalWidth, selectWidth } from "../structural/width";

export type StubDirection = "input" | "output" | "inout";

export interface StubPort {
  name: string;
  direction: StubDirection;
  width: number;
}

export interface Stub {
  moduleType: string;
  ports: StubPort[];
}

interface SymbolInfo {
  width: number;
  kind: "input" | "output" | "inout" | "wire" | "reg" | "logic" | "other";
}

function symbolsOf(m: SModule): Map<string, SymbolInfo> {
  const out = new Map<string, SymbolInfo>();
  for (const p of m.ports) out.set(p.name, { width: p.width || 1, kind: p.direction });
  for (const d of m.decls) if (!out.has(d.name)) out.set(d.name, { width: d.width || 1, kind: d.kind });
  return out;
}

function exprWidth(exprText: string, symbols: Map<string, SymbolInfo>): number {
  const t = exprText.trim();
  if (t === "") return 1;
  const lit = literalWidth(t);
  if (lit !== undefined) return lit;
  const sel = /^([A-Za-z_][\w$]*)\s*(\[[^\]]*\])$/.exec(t);
  if (sel && sel[2] !== undefined) return selectWidth(sel[2]) ?? 1;
  const concat = /^\{([\s\S]*)\}$/.exec(t);
  if (concat && concat[1] !== undefined) {
    let total = 0;
    let depth = 0;
    let cur = "";
    const parts: string[] = [];
    for (const ch of concat[1]) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      if (ch === "}" || ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);
    for (const p of parts) total += exprWidth(p, symbols);
    return total;
  }
  const sym = symbols.get(t);
  return sym ? sym.width : 1;
}

/**
 * Direction inference. Per pin of each undefined module type:
 * 1. definite: connected to a top input or a constant -> input; empty (.cout()) or a
 *    top output nothing else drives -> output; a wire driven by assign/always -> input;
 *    a wire read by assign/always and driven nowhere -> output.
 * 2. merged across instances of the same type.
 * 3. propagated along wires: a wire whose other pin is a known output makes this pin an input,
 *    and vice versa, until nothing changes.
 * 4. otherwise inout (rendered undirected).
 */
interface PinRef {
  type: string;
  pname: string;
  conn: SConnection;
  width: number;
}

function inferDirections(m: SModule, refs: PinRef[], symbols: Map<string, SymbolInfo>): Map<string, StubDirection> {
  const drivenByLogic = new Set<string>();
  const readByLogic = new Set<string>();
  for (const a of m.assigns) {
    for (const l of a.lhs) drivenByLogic.add(l);
    for (const r of a.rhs) readByLogic.add(r);
  }
  for (const a of m.always) {
    for (const l of a.assigned) drivenByLogic.add(l);
    for (const r of a.read) readByLogic.add(r);
  }
  const key = (r: PinRef): string => `${r.type}.${r.pname}`;
  const decided = new Map<string, StubDirection>();
  const vote = (k: string, d: StubDirection): void => {
    const prev = decided.get(k);
    if (prev === undefined) decided.set(k, d);
    else if (prev !== d) decided.set(k, "inout");
  };
  // 1 + 2: definite votes merged per type.pin
  for (const r of refs) {
    const c = r.conn;
    if (c.isConst) {
      vote(key(r), "input");
      continue;
    }
    if (c.idents.length === 0) {
      vote(key(r), "output");
      continue;
    }
    const kinds = c.idents.map((id) => symbols.get(id)?.kind);
    if (kinds.some((k) => k === "input")) vote(key(r), "input");
    else if (c.idents.some((id) => drivenByLogic.has(id))) vote(key(r), "input");
    else if (kinds.every((k) => k === "output")) vote(key(r), "output");
  }
  // 3: propagate along wires
  const byWire = new Map<string, PinRef[]>();
  for (const r of refs) for (const id of r.conn.idents) (byWire.get(id) ?? byWire.set(id, []).get(id)!).push(r);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of refs) {
      const k = key(r);
      if (decided.has(k)) continue;
      let out = false;
      let inp = false;
      for (const id of r.conn.idents) {
        for (const o of byWire.get(id) ?? []) {
          if (key(o) === k) continue;
          const d = decided.get(key(o));
          if (d === "output") out = true;
          if (d === "input") inp = true;
        }
      }
      if (out) {
        decided.set(k, "input");
        changed = true;
      } else if (inp) {
        decided.set(k, "output");
        changed = true;
      }
    }
  }
  // Weak rule: a wire read by logic and driven nowhere else must be driven by this pin.
  for (const r of refs) {
    const k = key(r);
    if (!decided.has(k) && r.conn.idents.some((id) => readByLogic.has(id))) decided.set(k, "output");
  }
  for (const r of refs) if (!decided.has(key(r))) decided.set(key(r), "inout");
  return decided;
}

export function collectStubs(file: StructuralFile, top: string): Stub[] {
  const defined = new Set(file.modules.map((m) => m.name));
  const stubs = new Map<string, Stub>();
  const seen = new Set<string>();
  const queue = [top];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const m = file.modules.find((x) => x.name === name);
    if (!m) continue;
    const symbols = symbolsOf(m);
    const refs: PinRef[] = [];
    for (const inst of m.instances) {
      if (defined.has(inst.moduleType)) {
        queue.push(inst.moduleType);
        continue;
      }
      if (!/^[A-Za-z_][\w$]*$/.test(inst.moduleType)) continue;
      for (const c of inst.connections) {
        refs.push({ type: inst.moduleType, pname: c.port ?? `p${c.index}`, conn: c, width: exprWidth(c.exprText, symbols) });
      }
    }
    const dirs = inferDirections(m, refs, symbols);
    for (const r of refs) {
      let stub = stubs.get(r.type);
      if (!stub) {
        stub = { moduleType: r.type, ports: [] };
        stubs.set(r.type, stub);
      }
      const direction = dirs.get(`${r.type}.${r.pname}`) ?? "inout";
      const existing = stub.ports.find((p) => p.name === r.pname);
      if (!existing) stub.ports.push({ name: r.pname, direction, width: r.width });
      else {
        existing.width = Math.max(existing.width, r.width);
        if (existing.direction === "inout" && direction !== "inout") existing.direction = direction;
        else if (existing.direction !== direction && direction !== "inout") existing.direction = "inout";
      }
    }
  }
  return [...stubs.values()];
}

export function stubsToVerilog(stubs: Stub[]): string {
  const out: string[] = [];
  for (const s of stubs) {
    const ports = s.ports.map((p) => `${p.direction}${p.width > 1 ? ` [${p.width - 1}:0]` : ""} ${p.name}`);
    out.push(`(* blackbox *) module ${s.moduleType}(${ports.join(", ")});`);
    out.push("endmodule");
  }
  return out.length > 0 ? `${out.join("\n")}\n` : "";
}
