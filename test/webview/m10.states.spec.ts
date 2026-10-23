// Phase 4: focus mode, designed states and the contact sheet.
import { expect, test } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicDoc } from "../../src/ir/types";
import { renderModule } from "../../webview/render/svg";
import { layoutView } from "../accuracy/layout";
import { post, postRender, ROOT, startHarness } from "./harness";

const ART = join(ROOT, "artifacts");
let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  mkdirSync(ART, { recursive: true });
  harness = await startHarness();
});
test.afterAll(async () => {
  await new Promise<void>((r) => harness.server.close(() => r()));
});

function goldenDoc(name: string): SchematicDoc {
  return JSON.parse(readFileSync(join(ROOT, "test", "golden", `${name}.ir.json`), "utf8")) as SchematicDoc;
}

test("M10: hovering a wire focuses its net and dims the rest; Escape clears", async ({ page }) => {
  await page.goto(`${harness.url}/?theme=light`);
  await postRender(page, goldenDoc("7458"));
  const diagram = page.locator("#canvas > svg.schematic");
  const wire = diagram.locator('g.net[data-net="net:p1a"] path.net-path');
  // A bent wire's bounding-box centre is off the stroke, so the hover is dispatched on the path itself.
  await wire.dispatchEvent("mouseover");
  await expect(diagram).toHaveClass(/focus/);
  await expect(diagram.locator('g.net[data-net="net:p1a"]')).toHaveClass(/focused/);
  await expect(diagram.locator('g.port[data-port="p1a"]')).toHaveClass(/focused/);
  await expect(diagram.locator('g.port[data-port="p2a"]')).not.toHaveClass(/focused/);
  // The dim is a 120 ms transition, so poll the computed opacity.
  await expect.poll(() => diagram.locator('g.net[data-net="net:p2a"]').evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.5);
  await page.screenshot({ path: join(ART, "m10-focus.png") });
  await page.keyboard.press("Escape");
  await expect(diagram).not.toHaveClass(/focus/);
  // Hovering a gate lights every net on its pins.
  await diagram.locator("g.node-gate").first().dispatchEvent("mouseover");
  await expect(diagram.locator("g.node-gate").first()).toHaveClass(/focused/);
  expect(await diagram.locator("g.net.focused").count()).toBeGreaterThanOrEqual(3);
});

test("M10: loading, error and stale states each show one sentence and at most one button", async ({ page }) => {
  await page.goto(`${harness.url}/?theme=light`);
  await expect(page.locator("#empty")).toHaveText("Open a Verilog file (.v or .sv) to see its schematic.");
  await post(page, { type: "status", generation: 0, status: { fidelity: "structural", backend: "native", warmingUp: true } });
  await expect(page.locator("#empty")).toContainText("Starting Yosys");
  await post(page, { type: "status", generation: 0, status: { fidelity: "structural", backend: "native", message: "synthesizing (turning the code into gates)" } });
  await expect(page.locator("#empty")).toHaveText("Synthesizing: turning the code into gates.");
  await postRender(page, goldenDoc("7458"));
  await expect(page.locator("#empty")).toBeHidden();
  await post(page, { type: "error", generation: 1, error: { message: "missing ';' after 'p2a & p2b'", line: 5, column: 24, file: "7458.v" } });
  await expect(page.locator("#banner")).toBeVisible();
  await expect(page.locator("#banner button")).toHaveCount(1);
  await expect(page.locator("#banner button")).toHaveText("Go to line 5");
  await page.locator("#banner button").click();
  const posted = await page.evaluate(() => (globalThis as unknown as { __rtlLiveTestHooks: { posted: unknown[] } }).__rtlLiveTestHooks.posted);
  expect(JSON.stringify(posted)).toContain('"revealError"');
  await post(page, { type: "status", generation: 1, status: { fidelity: "stale", backend: "native", message: "showing the last good diagram; fix the error to update it" } });
  await expect(page.locator("#banner .banner-text")).toContainText("Showing the last good diagram.");
  await expect(page.locator(".badge")).toHaveText("Stale");
  await page.screenshot({ path: join(ART, "m10-stale-state.png") });
  await post(page, { type: "error", generation: 1, error: null });
  await expect(page.locator("#banner")).toBeHidden();
});

test("M10: contact sheet of every fixture", async ({ page }) => {
  const names = readdirSync(join(ROOT, "test", "golden"))
    .filter((f) => f.endsWith(".ir.json") && !f.endsWith(".gate.ir.json"))
    .map((f) => f.replace(/\.ir\.json$/, ""))
    .sort();
  const tiles: string[] = [];
  for (const name of names) {
    const doc = goldenDoc(name);
    const view = doc.modules[doc.top];
    if (!view) continue;
    const r = renderModule(view, await layoutView(view), { frame: true });
    const scale = Math.min(1, 260 / r.width, 160 / r.height);
    tiles.push(`<figure><svg class="schematic" width="${Math.ceil(r.width * scale)}" height="${Math.ceil(r.height * scale)}" viewBox="0 0 ${r.width} ${r.height}"><g class="viewport">${r.inner}</g></svg><figcaption>${name}</figcaption></figure>`);
  }
  const css = readFileSync(join(ROOT, "dist", "webview.css"), "utf8");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}
    :root{--vscode-editor-foreground:#000;--vscode-editor-background:#fff;--vscode-charts-blue:#1a85ff;--vscode-focusBorder:#0090f1;--vscode-descriptionForeground:#717171;--vscode-charts-yellow:#bf8803}
    body{margin:0;padding:12px;background:#fff;display:flex;flex-wrap:wrap;gap:12px;width:1176px;font-family:system-ui,sans-serif}
    figure{margin:0;width:280px;border:1px solid #ddd;border-radius:4px;padding:8px;display:flex;flex-direction:column;align-items:center;gap:4px}
    figcaption{font-size:11px;color:#444}</style></head><body>${tiles.join("")}</body></html>`;
  const file = join(ART, "contact-sheet.html");
  writeFileSync(file, html);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`file://${file}`);
  expect(await page.locator("figure").count()).toBe(tiles.length);
  expect(tiles.length).toBeGreaterThanOrEqual(40);
  const height = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 1200, height: Math.min(height + 24, 6000) });
  await page.screenshot({ path: join(ART, "contact-sheet.png") });
});
