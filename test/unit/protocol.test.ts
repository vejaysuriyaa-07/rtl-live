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

// Mutation run (2026-10-23): every field check in isWebviewToHost survived when flipped to true.
describe("protocol guards reject each malformed field", () => {
  it("log needs string text and level", () => {
    expect(isWebviewToHost({ type: "log", generation: 0, level: "info" })).toBe(false);
    expect(isWebviewToHost({ type: "log", generation: 0, level: 1, text: "x" })).toBe(false);
    expect(isWebviewToHost({ type: "log", generation: 0, level: "info", text: 5 })).toBe(false);
  });

  it("revealSource and revealError need numeric line and column", () => {
    expect(isWebviewToHost({ type: "revealSource", generation: 0, line: "1", column: 2 })).toBe(false);
    expect(isWebviewToHost({ type: "revealSource", generation: 0, line: 1 })).toBe(false);
    expect(isWebviewToHost({ type: "revealError", generation: 0, line: 1, column: "2" })).toBe(false);
    expect(isWebviewToHost({ type: "revealError", generation: 0, line: 1, column: 2 })).toBe(true);
  });

  it("export needs string data and a known format", () => {
    expect(isWebviewToHost({ type: "export", generation: 0, format: "svg" })).toBe(false);
    expect(isWebviewToHost({ type: "export", generation: 0, format: "svg", data: 1 })).toBe(false);
    expect(isWebviewToHost({ type: "export", generation: 0, format: "png", data: "" })).toBe(true);
    expect(isWebviewToHost({ type: "export", generation: 0, format: "svg", data: "" })).toBe(true);
  });

  it("selectTop, drill, highlighted, pong, setLanguage and setView check their payloads", () => {
    expect(isWebviewToHost({ type: "selectTop", generation: 0, top: 3 })).toBe(false);
    expect(isWebviewToHost({ type: "drill", generation: 0 })).toBe(false);
    expect(isWebviewToHost({ type: "highlighted", generation: 0, ids: ["a", 1] })).toBe(false);
    expect(isWebviewToHost({ type: "highlighted", generation: 0, ids: "a" })).toBe(false);
    expect(isWebviewToHost({ type: "highlighted", generation: 0, ids: [] })).toBe(true);
    expect(isWebviewToHost({ type: "pong", generation: 0, id: "1" })).toBe(false);
    expect(isWebviewToHost({ type: "setLanguage", generation: 0, language: "vhdl" })).toBe(false);
    expect(isWebviewToHost({ type: "setLanguage", generation: 0, language: "systemverilog" })).toBe(true);
    expect(isWebviewToHost({ type: "setView", generation: 0, view: "both" })).toBe(false);
  });

  it("generation must be a finite number on both directions", () => {
    expect(isHostToWebview({ type: "fit", generation: Number.NaN })).toBe(false);
    expect(isHostToWebview({ type: "fit", generation: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isHostToWebview({ type: "fit", generation: "1" })).toBe(false);
    expect(isHostToWebview("fit")).toBe(false);
    expect(isHostToWebview({ type: 7, generation: 1 })).toBe(false);
    expect(isWebviewToHost({ type: "ready", generation: Number.NaN })).toBe(false);
  });
});
