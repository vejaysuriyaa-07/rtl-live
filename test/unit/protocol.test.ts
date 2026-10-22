import { describe, expect, it } from "vitest";
import { isHostToWebview, isWebviewToHost } from "../../src/shared/protocol";

describe("protocol guards", () => {
  it("accepts well-formed webview messages", () => {
    expect(isWebviewToHost({ type: "ready", generation: 0 })).toBe(true);
    expect(isWebviewToHost({ type: "revealSource", generation: 3, line: 1, column: 2 })).toBe(true);
    expect(isWebviewToHost({ type: "log", generation: 0, level: "info", text: "x" })).toBe(true);
  });

  it("rejects malformed webview messages", () => {
    expect(isWebviewToHost(null)).toBe(false);
    expect(isWebviewToHost({ type: "ready" })).toBe(false);
    expect(isWebviewToHost({ type: "bogus", generation: 0 })).toBe(false);
    expect(isWebviewToHost({ type: "revealSource", generation: 0 })).toBe(false);
    expect(isWebviewToHost({ type: "export", generation: 0, format: "gif", data: "" })).toBe(false);
  });

  it("checks host messages", () => {
    expect(isHostToWebview({ type: "fit", generation: 1 })).toBe(true);
    expect(isHostToWebview({ type: "fit" })).toBe(false);
    expect(isHostToWebview({ type: "nope", generation: 1 })).toBe(false);
  });
});
