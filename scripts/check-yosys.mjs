#!/usr/bin/env node
// CI gate for the native Yosys test step. Prints the version of the yosys on
// PATH and writes ok=true|false and version=... to $GITHUB_OUTPUT when set.
// Builds older than MIN_YOSYS reject "write_json -noscopeinfo" (Ubuntu 24.04's
// apt package is 0.33); the workflow skips the native step with a notice
// instead of failing every golden test on a command syntax error. The
// extension itself retries without the flag at runtime; this check only
// decides what CI can verify. Exit code is 0 either way; a missing yosys is
// a reason to skip, not a failure of the build.
import { execFileSync } from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Oldest Yosys whose write_json accepts -noscopeinfo, with margin. */
export const MIN_YOSYS = "0.40";

/** "Yosys 0.70+12 (git sha1 ...)" -> "0.70+12"; undefined when the text is not a yosys banner. */
export function parseYosysVersion(output) {
  const m = /\bYosys\s+(\d+\.\d+\S*)/.exec(output);
  return m?.[1];
}

/** Numeric compare of the dotted part; "+N" commit suffixes and anything after them are ignored. */
export function compareVersions(a, b) {
  const parts = (v) =>
    v
      .split("+")[0]
      .split(".")
      .map((x) => Number.parseInt(x, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function yosysIsRecentEnough(output, min = MIN_YOSYS) {
  const v = parseYosysVersion(output);
  return v !== undefined && compareVersions(v, min) >= 0;
}

function yosysBanner() {
  try {
    return execFileSync("yosys", ["-V"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = /** @type {{ stdout?: string; stderr?: string; message?: string }} */ (e);
    return `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}

function main() {
  const banner = yosysBanner();
  const version = parseYosysVersion(banner);
  const ok = yosysIsRecentEnough(banner);
  const output = process.env["GITHUB_OUTPUT"];
  if (output) appendFileSync(output, `ok=${ok}\nversion=${version ?? "none"}\n`);
  if (ok) {
    console.log(`yosys ${version} found on PATH; the native Yosys tests run`);
    return 0;
  }
  const reason = version
    ? `yosys ${version} on PATH is older than ${MIN_YOSYS} (write_json -noscopeinfo is missing); the native Yosys tests are skipped`
    : "no yosys on PATH; the native Yosys tests are skipped";
  console.log(`::notice title=Native Yosys tests skipped::${reason}`);
  console.log(reason);
  return 0;
}

function invokedDirectly() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false; // argv[1] is not a path (node -e, a loader): imported, not run
  }
}

if (invokedDirectly()) process.exit(main());
