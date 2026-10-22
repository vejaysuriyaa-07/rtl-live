// SVG and PNG export. The SVG is self-contained: theme colours are resolved
// from the computed styles and inlined, so it has no external references.
import { fmt } from "./render/svg";

const EXPORT_PROPS = ["--rl-fg", "--rl-bg", "--rl-accent", "--rl-error", "--rl-focus", "--rl-muted", "--rl-font"];

export function resolvedThemeCss(): string {
  const cs = getComputedStyle(document.body);
  const vars = EXPORT_PROPS.map((p) => `${p}: ${cs.getPropertyValue(p).trim() || "#888"};`).join(" ");
  const sheet = Array.from(document.styleSheets)
    .flatMap((s) => {
      try {
        return Array.from(s.cssRules);
      } catch {
        return [];
      }
    })
    .filter((r) => r.cssText.includes(".schematic") || r.cssText.includes(".node") || r.cssText.includes(".net") || r.cssText.includes(".port") || r.cssText.includes(".module"))
    .map((r) => r.cssText)
    .join("\n");
  return `:root, svg { ${vars} } ${sheet}`;
}

export function exportSvg(viewport: SVGGElement, size: { width: number; height: number } | undefined): string | undefined {
  if (!size) return undefined;
  const css = resolvedThemeCss();
  const bg = getComputedStyle(document.body).getPropertyValue("--rl-bg").trim() || "#1e1e1e";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="schematic" width="${fmt(size.width)}" height="${fmt(size.height)}" viewBox="0 0 ${fmt(size.width)} ${fmt(size.height)}">` +
    `<style>${css}</style>` +
    `<rect width="100%" height="100%" fill="${bg}"/>` +
    `<g class="viewport">${viewport.innerHTML}</g>` +
    `</svg>`
  );
}

export async function exportPng(viewport: SVGGElement, size: { width: number; height: number } | undefined): Promise<string | undefined> {
  const svgText = exportSvg(viewport, size);
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
    c.width = Math.ceil(size.width * scale);
    c.height = Math.ceil(size.height * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  } finally {
    URL.revokeObjectURL(url);
  }
}
