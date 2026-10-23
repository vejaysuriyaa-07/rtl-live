// SVG and PNG export. The print palette (dark lines on white) is the default; the theme
// palette resolves the live theme colours from the computed styles and pins them.
import { diagramCssRules, exportDocument, FONT_FALLBACK, PRINT_COLORS, type ExportColors, type ExportPalette } from "./render/exportDoc";

/** Every rule of the loaded stylesheets the diagram uses, as text. */
function diagramCss(): string {
  const rules = Array.from(document.styleSheets).flatMap((s) => {
    try {
      return Array.from(s.cssRules).map((r) => r.cssText);
    } catch {
      return [];
    }
  });
  return diagramCssRules(rules).join("\n");
}

function themeColors(): ExportColors {
  const cs = getComputedStyle(document.body);
  const v = (p: string, fallback: string): string => cs.getPropertyValue(p).trim() || fallback;
  return {
    fg: v("--rl-fg", PRINT_COLORS.fg),
    bg: v("--rl-bg", PRINT_COLORS.bg),
    accent: v("--rl-accent", PRINT_COLORS.accent),
    muted: v("--rl-muted", PRINT_COLORS.muted),
    warn: v("--rl-warn", PRINT_COLORS.warn),
    error: v("--rl-error", PRINT_COLORS.error),
    focus: v("--rl-focus", PRINT_COLORS.focus),
    font: `${v("--rl-font", "")}, ${FONT_FALLBACK.font}`.replace(/^, /, ""),
    mono: `${v("--rl-mono", "")}, ${FONT_FALLBACK.mono}`.replace(/^, /, ""),
  };
}

export function exportSvg(viewport: SVGGElement, size: { width: number; height: number } | undefined, palette: ExportPalette = "print"): string | undefined {
  if (!size) return undefined;
  const colors = palette === "theme" ? themeColors() : PRINT_COLORS;
  return exportDocument({ inner: viewport.innerHTML, width: size.width, height: size.height }, diagramCss(), colors);
}

export async function exportPng(viewport: SVGGElement, size: { width: number; height: number } | undefined, palette: ExportPalette = "print"): Promise<string | undefined> {
  const svgText = exportSvg(viewport, size, palette);
  if (!svgText || !size) return undefined;
  const scale = 2;
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg image failed to load"));
      img.src = url;
    });
    const c = document.createElement("canvas");
    const m = (svgText.match(/width="([\d.]+)" height="([\d.]+)"/) ?? []) as string[];
    const w = Number(m[1] ?? size.width);
    const h = Number(m[2] ?? size.height);
    c.width = Math.ceil(w * scale);
    c.height = Math.ceil(h * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  } finally {
    URL.revokeObjectURL(url);
  }
}
