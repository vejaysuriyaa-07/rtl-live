import { describe, expect, it } from "vitest";
import { diagramCssRules, exportDocument, PRINT_COLORS } from "../../webview/render/exportDoc";
import { EXPORT_MARGIN } from "../../webview/render/tokens";

const inner = '<g class="nodes"><g class="node"><rect class="body" width="10" height="10"/></g></g>';

describe("export document", () => {
  it("adds a 24 px margin on every side and an opaque white background by default", () => {
    const svg = exportDocument({ inner, width: 100, height: 50 }, ".schematic .body { fill: red }", PRINT_COLORS);
    expect(EXPORT_MARGIN).toBe(24);
    expect(svg).toContain(`width="${100 + 48}" height="${50 + 48}" viewBox="0 0 ${100 + 48} ${50 + 48}"`);
    expect(svg).toContain('<rect width="100%" height="100%" fill="#ffffff"/>');
    expect(svg).toContain('<g class="viewport" transform="translate(24,24)">');
    expect(svg).toContain(inner);
  });
  it("pins the print palette and safe font stacks so the file looks finished outside VS Code", () => {
    const svg = exportDocument({ inner, width: 10, height: 10 }, "", PRINT_COLORS);
    expect(svg).toContain("--rl-fg: #1f1f1f;");
    expect(svg).toContain("--rl-bg: #ffffff;");
    expect(svg).toContain("--rl-accent: #0b5fc0;");
    expect(svg).toMatch(/--rl-font: [^;]*sans-serif;/);
    expect(svg).toMatch(/--rl-mono: [^;]*monospace;/);
    expect(svg).not.toContain("--vscode-");
  });
  it("pins the theme colours when asked for them, after the stylesheet so they win", () => {
    const theme = { ...PRINT_COLORS, fg: "#d4d4d4", bg: "#1e1e1e" };
    const svg = exportDocument({ inner, width: 10, height: 10 }, ":root { --rl-fg: var(--vscode-editor-foreground, #ccc); }", theme);
    expect(svg.indexOf("--rl-fg: #d4d4d4")).toBeGreaterThan(svg.indexOf("--vscode-editor-foreground"));
    expect(svg).toContain('fill="#1e1e1e"');
  });
  it("keeps the token block and the diagram rules, drops the toolbar", () => {
    const kept = diagramCssRules([":root { --rl-stroke-wire: 1.25px; }", "#toolbar { display: flex; }", ".schematic .net-path { fill: none; }", ".tb-btn { color: red; }", "body[data-theme=\"highContrast\"] { --rl-glow: 0px; }"]);
    expect(kept).toEqual([":root { --rl-stroke-wire: 1.25px; }", ".schematic .net-path { fill: none; }"]);
  });
});
