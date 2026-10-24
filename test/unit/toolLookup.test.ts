// Cross-platform tool lookup: the setting first, then PATH (with PATHEXT on Windows),
// then common folders; every candidate is verified and a broken one is skipped.
import { describe, expect, it } from "vitest";
import {
  candidateNames,
  candidates,
  commonDirs,
  describeEngine,
  describeLookup,
  fallbackMessage,
  findToolSync,
  locateTool,
  parseVersion,
  type LookupEnv,
  type ToolProbe,
} from "../../src/synth/toolLookup";

function env(
  platform: NodeJS.Platform,
  files: string[],
  vars: Record<string, string> = {},
  home = platform === "win32" ? "C:\\Users\\me" : "/home/me",
): LookupEnv {
  const set = new Set(platform === "win32" ? files.map((f) => f.toLowerCase()) : files);
  return { platform, env: vars, home, isFile: (p) => set.has(platform === "win32" ? p.toLowerCase() : p) };
}

const answers = (table: Record<string, string | undefined>): ToolProbe => {
  const calls: string[] = [];
  const probe: ToolProbe = (path) => {
    calls.push(path);
    return Promise.resolve(table[path]);
  };
  (probe as ToolProbe & { calls: string[] }).calls = calls;
  return probe;
};

describe("candidate order", () => {
  it("posix: PATH folders in order, then the common folders, bare names only", () => {
    const e = env("linux", [], { PATH: "/usr/bin:/home/me/bin::/opt/x/bin" });
    const c = candidates("yosys", undefined, e);
    expect(c.slice(0, 3).map((x) => `${x.source} ${x.path}`)).toEqual([
      "PATH /usr/bin/yosys",
      "PATH /home/me/bin/yosys",
      "PATH /opt/x/bin/yosys",
    ]);
    expect(c.filter((x) => x.source === "common").map((x) => x.path)).toEqual(
      commonDirs(e)
        .filter((d) => d !== "/usr/bin")
        .map((d) => `${d}/yosys`),
    );
    expect(commonDirs(e)).toEqual([
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/home/me/.local/bin",
      "/home/me/oss-cad-suite/bin",
      "/opt/oss-cad-suite/bin",
      "/home/me/opt/oss-cad-suite/bin",
    ]);
  });

  it("windows: PATHEXT names with .exe first, semicolon PATH, oss-cad-suite under LOCALAPPDATA", () => {
    const e = env("win32", [], {
      Path: "C:\\tools;D:\\oss-cad-suite\\bin",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    });
    expect(candidateNames("yosys", e)).toEqual(["yosys.exe", "yosys.com", "yosys.bat", "yosys.cmd", "yosys"]);
    const c = candidates("yosys", undefined, e);
    expect(c[0]).toEqual({ path: "C:\\tools\\yosys.exe", source: "PATH", from: "C:\\tools" });
    expect(c.map((x) => x.path)).toContain("D:\\oss-cad-suite\\bin\\yosys.exe");
    expect(commonDirs(e)[0]).toBe("C:\\Users\\me\\AppData\\Local\\oss-cad-suite\\bin");
    expect(commonDirs(e)).toContain("C:\\Users\\me\\oss-cad-suite\\bin");
    expect(candidateNames("yosys", { ...e, env: {} })).toEqual([
      "yosys.exe",
      "yosys.com",
      "yosys.bat",
      "yosys.cmd",
      "yosys",
    ]);
  });

  it("the setting comes first and is not deduplicated against PATH", () => {
    const e = env("darwin", [], { PATH: "/usr/local/bin" });
    const c = candidates("verilator", "  /opt/mine/verilator ", e);
    expect(c[0]).toEqual({ path: "/opt/mine/verilator", source: "setting", from: "rtlLive.verilatorPath" });
    expect(c[1]!.path).toBe("/usr/local/bin/verilator");
    expect(candidates("verilator", "   ", e)[0]!.source).toBe("PATH");
  });
});

describe("locateTool", () => {
  it("takes the first existing candidate that answers its version flag", async () => {
    const e = env("linux", ["/usr/bin/yosys", "/opt/homebrew/bin/yosys"], { PATH: "/usr/bin" });
    const probe = answers({ "/usr/bin/yosys": "Yosys 0.44 (git sha1 abc)\n" });
    const r = await locateTool("yosys", undefined, e, probe);
    expect(r.found).toEqual({
      tool: "yosys",
      path: "/usr/bin/yosys",
      source: "PATH",
      from: "/usr/bin",
      version: "0.44",
    });
    expect(r.skipped).toEqual([]);
    expect((probe as ToolProbe & { calls: string[] }).calls).toEqual(["/usr/bin/yosys"]);
  });

  it("the setting overrides PATH even when PATH has a working binary", async () => {
    const e = env("linux", ["/usr/bin/yosys", "/opt/mine/yosys"], { PATH: "/usr/bin" });
    const r = await locateTool(
      "yosys",
      "/opt/mine/yosys",
      e,
      answers({ "/opt/mine/yosys": "Yosys 0.50", "/usr/bin/yosys": "Yosys 0.44" }),
    );
    expect(r.found?.path).toBe("/opt/mine/yosys");
    expect(r.found?.source).toBe("setting");
    expect(r.found?.version).toBe("0.50");
  });

  it("a broken binary is skipped with a reason and the next one is used; a missing setting is reported", async () => {
    const e = env("linux", ["/usr/bin/yosys", "/usr/local/bin/yosys"], { PATH: "/usr/bin" });
    const r = await locateTool(
      "yosys",
      "/nowhere/yosys",
      e,
      answers({ "/usr/bin/yosys": undefined, "/usr/local/bin/yosys": "Yosys 0.47" }),
      3000,
    );
    expect(r.found?.path).toBe("/usr/local/bin/yosys");
    expect(r.found?.source).toBe("common");
    expect(r.skipped).toEqual([
      { path: "/nowhere/yosys", source: "setting", reason: "not found" },
      { path: "/usr/bin/yosys", source: "PATH", reason: "did not answer -V within 3000 ms" },
    ]);
  });

  it("nothing found: every searched folder is listed and the report says so", async () => {
    const e = env("darwin", [], { PATH: "/usr/bin:/bin" });
    const r = await locateTool("yosys", undefined, e, answers({}));
    expect(r.found).toBeUndefined();
    expect(r.searched.slice(0, 3)).toEqual(["/usr/bin", "/bin", "/opt/homebrew/bin"]);
    const text = describeLookup("yosys", r);
    expect(text[0]).toMatch(
      /^yosys: not found\. Searched \d+ folders: \/usr\/bin, \/bin, \/opt\/homebrew\/bin/,
    );
  });

  it("windows: finds yosys.exe on PATH, skips a .cmd wrapper, and the report names the folder", async () => {
    const e = env("win32", ["C:\\wrap\\yosys.cmd", "D:\\oss-cad-suite\\bin\\yosys.exe"], {
      Path: "C:\\wrap;D:\\oss-cad-suite\\bin",
      PATHEXT: ".EXE;.CMD",
    });
    const r = await locateTool(
      "yosys",
      undefined,
      e,
      answers({ "D:\\oss-cad-suite\\bin\\yosys.exe": "Yosys 0.48+12 (git sha1 x)" }),
    );
    expect(r.found?.path).toBe("D:\\oss-cad-suite\\bin\\yosys.exe");
    expect(r.found?.version).toBe("0.48+12");
    expect(r.skipped.map((s) => s.path)).toEqual(["C:\\wrap\\yosys.cmd"]);
    expect(describeLookup("yosys", r)[0]).toBe(
      "yosys: D:\\oss-cad-suite\\bin\\yosys.exe (0.48+12, on PATH (D:\\oss-cad-suite\\bin))",
    );
    expect(describeLookup("yosys", r)[1]).toContain("skipped C:\\wrap\\yosys.cmd");
  });

  it("findToolSync returns the first existing spawnable candidate without probing", () => {
    expect(
      findToolSync("verilator", undefined, env("linux", ["/usr/local/bin/verilator"], { PATH: "/usr/bin" })),
    ).toBe("/usr/local/bin/verilator");
    expect(findToolSync("verilator", undefined, env("linux", [], { PATH: "/usr/bin" }))).toBeUndefined();
    expect(
      findToolSync("yosys", undefined, env("win32", ["C:\\t\\yosys.bat"], { Path: "C:\\t" })),
    ).toBeUndefined();
  });

  it("parses the version line of each tool", () => {
    expect(parseVersion("yosys", "\nYosys 0.44+60 (git sha1 abc, clang 15)\n")).toBe("0.44+60");
    expect(parseVersion("verilator", "Verilator 5.028 2024-08-21 rev v5.028\n")).toBe("5.028");
    expect(parseVersion("iverilog", "Icarus Verilog version 12.0 (stable) ()\n")).toBe("12.0");
    expect(parseVersion("yosys", "something else")).toBe("something else");
  });
});

describe("fallback notice", () => {
  const notFound = { skipped: [], searched: ["/usr/bin"] };
  it("is shown only when the choice was left open and nothing usable was found", () => {
    expect(fallbackMessage("auto", notFound)).toBe(
      "Using the built-in engine. Install Yosys for faster results, or set rtlLive.yosysPath.",
    );
    expect(fallbackMessage("native", notFound)).toBe(
      "Using the built-in engine. Install Yosys for faster results, or set rtlLive.yosysPath.",
    );
    expect(fallbackMessage("wasm", notFound)).toBeUndefined();
    expect(fallbackMessage("off", notFound)).toBeUndefined();
    expect(
      fallbackMessage("auto", {
        found: { tool: "yosys", path: "/usr/bin/yosys", source: "PATH", from: "/usr/bin" },
        skipped: [],
        searched: [],
      }),
    ).toBeUndefined();
    expect(fallbackMessage("auto", undefined)).toBe(
      "Using the built-in engine. Install Yosys for faster results, or set rtlLive.yosysPath.",
    );
  });

  it("names a setting that points nowhere or at a broken binary", () => {
    expect(
      fallbackMessage("auto", {
        skipped: [{ path: "/nowhere/yosys", source: "setting", reason: "not found" }],
        searched: [],
      }),
    ).toBe("Using the built-in engine. rtlLive.yosysPath points at /nowhere/yosys, which does not exist.");
    expect(
      fallbackMessage("auto", {
        skipped: [{ path: "/bad/yosys", source: "setting", reason: "did not answer -V within 3000 ms" }],
        searched: [],
      }),
    ).toBe(
      "Using the built-in engine. rtlLive.yosysPath points at /bad/yosys, which did not answer -V within 3000 ms.",
    );
  });
});

describe("rehearsal switch RTL_LIVE_<TOOL>=off", () => {
  it("hides every existing candidate of that tool with a reason and never probes it", async () => {
    const e = env("linux", ["/usr/bin/yosys", "/usr/bin/verilator"], {
      PATH: "/usr/bin",
      RTL_LIVE_YOSYS: "off",
    });
    const probe = answers({ "/usr/bin/yosys": "Yosys 0.44\n", "/usr/bin/verilator": "Verilator 5.028\n" });
    const y = await locateTool("yosys", undefined, e, probe);
    expect(y.found).toBeUndefined();
    expect(y.skipped.map((s) => `${s.path}: ${s.reason}`)).toEqual([
      "/usr/bin/yosys: hidden by RTL_LIVE_YOSYS=off",
    ]);
    expect(y.searched).toContain("/usr/bin");
    expect(findToolSync("yosys", undefined, e)).toBeUndefined();
    // other tools are not affected
    const v = await locateTool("verilator", undefined, e, probe);
    expect(v.found?.path).toBe("/usr/bin/verilator");
    expect((probe as ToolProbe & { calls: string[] }).calls).toEqual(["/usr/bin/verilator"]);
  });
});

describe("describeEngine", () => {
  it("always yields one engine line, including the loading and undecided states", () => {
    expect(describeEngine({ setting: "off", backend: "none", warmingUp: false, deciding: false })).toBe(
      "synthesis engine: off (rtlLive.synthesisBackend)",
    );
    expect(
      describeEngine({
        setting: "auto",
        backend: "native",
        version: "0.44",
        path: "/usr/bin/yosys",
        warmingUp: false,
        deciding: false,
      }),
    ).toBe("synthesis engine: native yosys 0.44 at /usr/bin/yosys");
    expect(
      describeEngine({
        setting: "auto",
        backend: "native",
        path: "/usr/bin/yosys",
        warmingUp: false,
        deciding: false,
      }),
    ).toBe("synthesis engine: native yosys at /usr/bin/yosys");
    expect(
      describeEngine({
        setting: "auto",
        backend: "wasm",
        version: "0.70",
        warmingUp: false,
        deciding: false,
      }),
    ).toBe("synthesis engine: built-in wasm yosys 0.70");
    expect(describeEngine({ setting: "auto", backend: "none", warmingUp: true, deciding: true })).toBe(
      "synthesis engine: built-in wasm yosys, loading",
    );
    expect(describeEngine({ setting: "auto", backend: "none", warmingUp: false, deciding: true })).toBe(
      "synthesis engine: not decided yet, looking for yosys",
    );
    expect(describeEngine({ setting: "auto", backend: "none", warmingUp: false, deciding: false })).toBe(
      "synthesis engine: not started",
    );
  });
});
