// Pure builder for the exported SVG document, kept free of the DOM so it is unit tested
// in node. The export is self-contained: the diagram stylesheet is inlined and every theme
// variable is pinned to a colour, so the file looks the same outside VS Code.
import { EXPORT_MARGIN } from "./tokens";
import { fmt } from "./svg";

export type ExportPalette = "print" | "theme";

/** Colours and fonts an exported file is pinned to. */
export interface ExportColors {
  fg: string;
  bg: string;
  accent: string;
  muted: string;
  warn: string;
  error: string;
  focus: string;
  font: string;
  mono: string;
}

/** Dark lines on white, for documents and print. */
export const PRINT_COLORS: ExportColors = {
  fg: "#1f1f1f",
  bg: "#ffffff",
  accent: "#0b5fc0",
  muted: "#5f5f5f",
  warn: "#9a6b00",
  error: "#c42b1c",
  focus: "#0b5fc0",
  font: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

/** Fallback fonts appended to a theme font so the file renders on a machine without it. */
export const FONT_FALLBACK = { font: "system-ui, sans-serif", mono: "ui-monospace, Menlo, Consolas, monospace" } as const;

/** Keeps the stylesheet rules the diagram needs: the token block on :root and the .schematic rules. */
export function diagramCssRules(rules: readonly string[]): string[] {
  return rules.filter((r) => /^\s*:root\b/.test(r) || /\.(schematic|node|net|port|module)\b/.test(r));
}

export interface ExportInput {
  inner: string;
  width: number;
  height: number;
}

/**
 * The exported document: the diagram with a margin on every side, an opaque background and
 * the stylesheet inlined with the palette pinned. `css` is the diagram stylesheet text.
 */
export function exportDocument(r: ExportInput, css: string, colors: ExportColors, margin = EXPORT_MARGIN): string {
  const w = r.width + 2 * margin;
  const h = r.height + 2 * margin;
  const vars =
    `--rl-fg: ${colors.fg}; --rl-bg: ${colors.bg}; --rl-accent: ${colors.accent}; --rl-muted: ${colors.muted}; ` +
    `--rl-warn: ${colors.warn}; --rl-error: ${colors.error}; --rl-focus: ${colors.focus}; --rl-ok: ${colors.muted}; ` +
    `--rl-font: ${colors.font}; --rl-mono: ${colors.mono};`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="schematic" width="${fmt(w)}" height="${fmt(h)}" viewBox="0 0 ${fmt(w)} ${fmt(h)}">` +
    `<style>${css}\n:root, svg { ${vars} }</style>` +
    `<rect width="100%" height="100%" fill="${colors.bg}"/>` +
    `<g class="viewport" transform="translate(${fmt(margin)},${fmt(margin)})">${r.inner}</g>` +
    `</svg>`
  );
}
