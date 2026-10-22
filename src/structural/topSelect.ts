// Picks the top module: explicit override, else top_module, else the one
// module nobody instantiates, else the module under the cursor, else the first.
import type { SModule } from "./types";

export interface TopSelectInput {
  modules: SModule[];
  override?: string | undefined;
  cursorLine?: number | undefined;
}

export function selectTop(input: TopSelectInput): string {
  const { modules } = input;
  if (modules.length === 0) return "";
  const names = new Set(modules.map((m) => m.name));
  if (input.override !== undefined && names.has(input.override)) return input.override;
  if (names.has("top_module")) return "top_module";
  const instantiated = new Set<string>();
  for (const m of modules) for (const i of m.instances) instantiated.add(i.moduleType);
  const roots = modules.filter((m) => !instantiated.has(m.name));
  if (roots.length === 1 && roots[0]) return roots[0].name;
  if (input.cursorLine !== undefined) {
    const under = modules.find((m) => m.src.line <= input.cursorLine! && m.src.endLine >= input.cursorLine!);
    if (under) return under.name;
  }
  const first = roots[0] ?? modules[0];
  return first ? first.name : "";
}
