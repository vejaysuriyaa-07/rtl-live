// Types for the subset of Yosys write_json output we read.
export type YosysBit = number | "0" | "1" | "x" | "z";

export interface YosysPort {
  direction: "input" | "output" | "inout";
  bits: YosysBit[];
}

export interface YosysCell {
  hide_name?: number;
  type: string;
  parameters?: Record<string, string | number>;
  attributes?: Record<string, string | number>;
  port_directions?: Record<string, "input" | "output" | "inout">;
  connections: Record<string, YosysBit[]>;
}

export interface YosysNetname {
  hide_name?: number;
  bits: YosysBit[];
  attributes?: Record<string, string | number>;
}

export interface YosysModule {
  attributes?: Record<string, string | number>;
  ports: Record<string, YosysPort>;
  cells: Record<string, YosysCell>;
  netnames: Record<string, YosysNetname>;
}

export interface YosysDesign {
  creator?: string;
  modules: Record<string, YosysModule>;
}

export function isYosysDesign(x: unknown): x is YosysDesign {
  return typeof x === "object" && x !== null && typeof (x as { modules?: unknown }).modules === "object";
}

/** Yosys parameters are often binary strings; read as integer. */
export function paramInt(p: string | number | undefined, fallback = 0): number {
  if (p === undefined) return fallback;
  if (typeof p === "number") return p;
  if (/^[01]+$/.test(p)) return parseInt(p, 2);
  const n = Number(p);
  return Number.isFinite(n) ? n : fallback;
}
