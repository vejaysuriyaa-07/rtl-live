// Builds the Yosys script. Unit tested as a string.
export interface ScriptOptions {
  top: string;
  /** A blackboxes.v file is provided and must be read */
  hasBlackboxes: boolean;
  /** Insert "opt -fast" before writing the netlist */
  optimize: boolean;
  /** Extra passes, semicolon separated, inserted before write_json */
  extraPasses?: string | undefined;
  /** Use "proc -norom" (verified with module_shift8 in M5) */
  procNorom: boolean;
  /** Pass -noscopeinfo to write_json (drop if the backend rejects it) */
  noScopeInfo: boolean;
}

export const INPUT_FILE = "input.v";
export const BLACKBOX_FILE = "blackboxes.v";
export const OUTPUT_FILE = "out.json";
export const SCRIPT_FILE = "script.ys";

/** Reject anything that could break out of the script line (newlines, shell-ish characters are harmless to yosys). */
export function sanitizeExtraPasses(extra: string | undefined): string[] {
  if (!extra) return [];
  return extra
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/[\r\n]/.test(s));
}

export function sanitizeTop(top: string): string {
  if (!/^[A-Za-z_][\w$]*$/.test(top)) throw new Error(`invalid top module name: ${top}`);
  return top;
}

export function buildScript(opts: ScriptOptions): string {
  const lines: string[] = [];
  lines.push(`read_verilog -sv ${INPUT_FILE}`);
  if (opts.hasBlackboxes) lines.push(`read_verilog -sv ${BLACKBOX_FILE}`);
  lines.push(`hierarchy -top ${sanitizeTop(opts.top)}`);
  lines.push(opts.procNorom ? "proc -norom" : "proc");
  lines.push("opt_clean");
  lines.push("opt_expr -mux_undef");
  lines.push("opt_clean");
  if (opts.optimize) lines.push("opt -fast");
  for (const p of sanitizeExtraPasses(opts.extraPasses)) lines.push(p);
  lines.push(`write_json${opts.noScopeInfo ? " -noscopeinfo" : ""} ${OUTPUT_FILE}`);
  return `${lines.join("\n")}\n`;
}
