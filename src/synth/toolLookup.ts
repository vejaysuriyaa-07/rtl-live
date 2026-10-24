// Finds external tools (yosys, verilator, iverilog) the same way on every OS.
//
// Order: (1) the setting, when set; (2) every folder in PATH, with the PATHEXT
// extensions on Windows; (3) common install folders. A candidate is only taken
// after it answers its version flag within a short timeout, so a broken binary
// is skipped and the next one is tried. All spawns use an args array, never a
// shell string. Pure apart from the injected file and process probes, so the
// unit tests fake a PATH, a Windows layout or a broken binary.
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export type ToolName = "yosys" | "verilator" | "iverilog" | "vvp";

export type LookupSource = "setting" | "PATH" | "common";

export interface ToolLocation {
  tool: ToolName;
  path: string;
  source: LookupSource;
  /** Folder or setting the candidate came from, for the report */
  from: string;
  version?: string;
}

export interface LookupEnv {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  /** True when the path exists and is a file */
  isFile(path: string): boolean;
}

export interface ToolProbe {
  /** Runs the binary with the version flag; resolves with stdout+stderr, or undefined on failure or timeout. */
  (path: string, args: string[], timeoutMs: number): Promise<string | undefined>;
}

export interface SkippedCandidate {
  path: string;
  source: LookupSource;
  reason: string;
}

export interface LookupResult {
  found?: ToolLocation;
  skipped: SkippedCandidate[];
  /** Folders that were searched, for the report */
  searched: string[];
}

export const VERSION_ARGS: Record<ToolName, string[]> = {
  yosys: ["-V"],
  verilator: ["--version"],
  iverilog: ["-V"],
  vvp: ["-V"],
};

export const VERIFY_TIMEOUT_MS = 3000;

/** RTL_LIVE_<TOOL>=off hides an installed tool, to rehearse what a machine without it does. */
function hiddenBySwitch(tool: ToolName, e: LookupEnv): string | undefined {
  const name = `RTL_LIVE_${tool.toUpperCase()}`;
  return e.env[name] === "off" ? `hidden by ${name}=off` : undefined;
}

export function realLookupEnv(env: NodeJS.ProcessEnv = process.env): LookupEnv {
  return {
    platform: process.platform,
    env,
    home: homedir(),
    isFile: (p) => {
      try {
        return existsSync(p) && statSync(p).isFile();
      } catch {
        return false;
      }
    },
  };
}

export const realProbe: ToolProbe = (path, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(path, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve(err ? undefined : `${stdout}${stderr}`);
    });
  });

function pathApi(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === "win32" ? win32 : posix;
}

/** Folders checked after PATH. Order is the order they are tried. */
export function commonDirs(e: LookupEnv): string[] {
  const p = pathApi(e.platform);
  const out: string[] = [];
  if (e.platform === "win32") {
    const local = e.env["LOCALAPPDATA"];
    const programs = e.env["ProgramFiles"];
    for (const base of [local, programs, "C:\\"]) if (base) out.push(p.join(base, "oss-cad-suite", "bin"));
    out.push(p.join(e.home, "oss-cad-suite", "bin"));
  } else {
    out.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", p.join(e.home, ".local", "bin"));
    out.push(
      p.join(e.home, "oss-cad-suite", "bin"),
      "/opt/oss-cad-suite/bin",
      p.join(e.home, "opt", "oss-cad-suite", "bin"),
    );
  }
  return out;
}

/** File names to try for a tool in one folder: the bare name, plus PATHEXT variants on Windows. */
export function candidateNames(tool: ToolName, e: LookupEnv): string[] {
  if (e.platform !== "win32") return [tool];
  const exts = (e.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((x) => x !== "");
  // .exe first: a .cmd or .bat wrapper cannot be spawned without a shell and is skipped by the probe.
  const ordered = [
    ...exts.filter((x) => x.toLowerCase() === ".exe"),
    ...exts.filter((x) => x.toLowerCase() !== ".exe"),
  ];
  return [...ordered.map((x) => `${tool}${x.toLowerCase()}`), tool];
}

function pathDirs(e: LookupEnv): string[] {
  const p = pathApi(e.platform);
  const raw = e.env["PATH"] ?? e.env["Path"] ?? "";
  return raw
    .split(p.delimiter)
    .map((d) => d.trim())
    .filter((d) => d !== "");
}

/** Every candidate file in lookup order, without probing. The setting comes first when set. */
export function candidates(
  tool: ToolName,
  configured: string | undefined,
  e: LookupEnv,
): { path: string; source: LookupSource; from: string }[] {
  const p = pathApi(e.platform);
  const out: { path: string; source: LookupSource; from: string }[] = [];
  const setting = configured?.trim() ?? "";
  if (setting !== "") out.push({ path: setting, source: "setting", from: `rtlLive.${tool}Path` });
  const seen = new Set<string>();
  const names = candidateNames(tool, e);
  const add = (dir: string, source: LookupSource): void => {
    for (const name of names) {
      const full = p.join(dir, name);
      const key = e.platform === "win32" ? full.toLowerCase() : full;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path: full, source, from: dir });
    }
  };
  for (const dir of pathDirs(e)) add(dir, "PATH");
  for (const dir of commonDirs(e)) add(dir, "common");
  return out;
}

/** A spawnable program: on Windows a .cmd or .bat needs a shell, which this extension never uses. */
function spawnable(path: string, e: LookupEnv): boolean {
  if (e.platform !== "win32") return true;
  const ext = win32.extname(path).toLowerCase();
  return ext !== ".cmd" && ext !== ".bat";
}

export function parseVersion(tool: ToolName, output: string): string {
  const line = output.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const m =
    tool === "yosys"
      ? /Yosys\s+(\S+)/.exec(line)
      : tool === "verilator"
        ? /Verilator\s+(\S+)/.exec(line)
        : /Icarus Verilog version\s+(\S+)/.exec(line);
  return m?.[1] ?? line.trim();
}

/**
 * Finds a tool and verifies it. A candidate that is missing, not a file, not
 * spawnable or does not answer its version flag is skipped with a reason.
 */
export async function locateTool(
  tool: ToolName,
  configured: string | undefined,
  e: LookupEnv,
  probe: ToolProbe,
  timeoutMs = VERIFY_TIMEOUT_MS,
): Promise<LookupResult> {
  const skipped: SkippedCandidate[] = [];
  const searched: string[] = [];
  const hidden = hiddenBySwitch(tool, e);
  for (const c of candidates(tool, configured, e)) {
    if (!searched.includes(c.from)) searched.push(c.from);
    if (!e.isFile(c.path)) {
      if (c.source === "setting") skipped.push({ path: c.path, source: c.source, reason: "not found" });
      continue;
    }
    if (hidden) {
      skipped.push({ path: c.path, source: c.source, reason: hidden });
      continue;
    }
    if (!spawnable(c.path, e)) {
      skipped.push({
        path: c.path,
        source: c.source,
        reason: "a .cmd or .bat wrapper cannot be run directly; point the setting at the .exe",
      });
      continue;
    }
    const out = await probe(c.path, VERSION_ARGS[tool], timeoutMs);
    if (out === undefined) {
      skipped.push({
        path: c.path,
        source: c.source,
        reason: `did not answer ${VERSION_ARGS[tool].join(" ")} within ${timeoutMs} ms`,
      });
      continue;
    }
    return {
      found: { tool, path: c.path, source: c.source, from: c.from, version: parseVersion(tool, out) },
      skipped,
      searched,
    };
  }
  return { skipped, searched };
}

/** First existing candidate without probing; for callers that verify later (tests, bench). */
export function findToolSync(
  tool: ToolName,
  configured: string | undefined,
  e: LookupEnv = realLookupEnv(),
): string | undefined {
  if (hiddenBySwitch(tool, e)) return undefined;
  for (const c of candidates(tool, configured, e))
    if (e.isFile(c.path) && spawnable(c.path, e)) return c.path;
  return undefined;
}

/**
 * The one-time notice when the extension falls back to the built-in engine because no native
 * yosys could be used while the setting left the choice open. Undefined when the user chose the
 * engine, or when native yosys was found.
 */
export function fallbackMessage(
  backendSetting: "auto" | "native" | "wasm" | "off",
  r: LookupResult | undefined,
): string | undefined {
  if (backendSetting === "wasm" || backendSetting === "off") return undefined;
  if (r?.found) return undefined;
  const skipped = r?.skipped.find((s) => s.source === "setting");
  if (skipped)
    return `Using the built-in engine. rtlLive.yosysPath points at ${skipped.path}, which ${skipped.reason === "not found" ? "does not exist" : skipped.reason}.`;
  return "Using the built-in engine. Install Yosys for faster results, or set rtlLive.yosysPath.";
}

export interface EngineState {
  setting: "auto" | "native" | "wasm" | "off";
  backend: "native" | "wasm" | "none";
  version?: string;
  path?: string;
  /** The built-in engine is loading its wasm */
  warmingUp: boolean;
  /** A lookup or load is in flight and no backend has been chosen yet */
  deciding: boolean;
}

/** The engine line of the "Show tool paths" report; there is always one, whatever the state. */
export function describeEngine(st: EngineState): string {
  let engine: string;
  if (st.setting === "off") engine = "off (rtlLive.synthesisBackend)";
  else if (st.backend === "native")
    engine = ["native yosys", st.version, "at", st.path ?? "?"]
      .filter((x) => x !== undefined && x !== "")
      .join(" ");
  else if (st.backend === "wasm")
    engine = ["built-in wasm yosys", st.version].filter((x) => x !== undefined && x !== "").join(" ");
  else if (st.warmingUp) engine = "built-in wasm yosys, loading";
  else if (st.deciding) engine = "not decided yet, looking for yosys";
  else engine = "not started";
  return `synthesis engine: ${engine}`;
}

/** One line per tool for the "Show tool paths" command and the log. */
export function describeLookup(tool: ToolName, r: LookupResult): string[] {
  const lines: string[] = [];
  if (r.found) {
    const how =
      r.found.source === "setting"
        ? "from the setting"
        : r.found.source === "PATH"
          ? `on PATH (${r.found.from})`
          : `in ${r.found.from}`;
    lines.push(`${tool}: ${r.found.path} (${r.found.version ?? "version unknown"}, ${how})`);
  } else {
    lines.push(
      `${tool}: not found. Searched ${r.searched.length} folder${r.searched.length === 1 ? "" : "s"}: ${r.searched.join(", ")}`,
    );
  }
  for (const s of r.skipped) lines.push(`  skipped ${s.path}: ${s.reason}`);
  return lines;
}
