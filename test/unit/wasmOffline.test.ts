// The built-in engine promises to work offline: @yowasp/yosys must load its wasm and resource
// tar from the files next to its bundle (file: URLs read with fs), never over the network. Its
// progress callback says "fetched", which is only the runtime's wording for a disk read.
import v8 from "node:v8";
import { describe, expect, it } from "vitest";

type Progress = { source: { argv0: string }; totalLength: number; doneLength: number };
type Yosys = {
  runYosys: (
    args?: string[],
    files?: Record<string, never>,
    options?: {
      stdout?: (b: Uint8Array | null) => void;
      decodeASCII?: boolean;
      fetchProgress?: (p: Progress) => void;
    },
  ) => Promise<unknown>;
  version: string;
};

describe("built-in yosys resources", () => {
  it("are read from disk: with global fetch disabled the engine still starts and answers -V", async () => {
    try {
      v8.setFlagsFromString("--experimental-wasm-exnref");
    } catch {
      // older or newer V8: the flag is absent or already on
    }
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      return Promise.reject(new Error("network use is forbidden in this test"));
    }) as typeof fetch;
    try {
      const y = (await import("@yowasp/yosys")) as unknown as Yosys;
      const progress: Progress[] = [];
      let text = "";
      await y.runYosys(undefined, {}, { fetchProgress: (p) => progress.push(p) });
      await y
        .runYosys(
          ["-V"],
          {},
          {
            stdout: (b) => {
              if (b) text += new TextDecoder().decode(b);
            },
            decodeASCII: false,
          },
        )
        .catch(() => undefined);
      expect(text).toMatch(/Yosys \d/);
      expect(calls).toEqual([]);
      expect(progress.length).toBeGreaterThan(0);
      expect(progress.every((p) => p.source.argv0 === "yowasp-yosys")).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 120_000);
});
