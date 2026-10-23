// v0.4 behaviour: hover lifts an element with a glow and never recolours it, focus mode fades
// the rest to 35 percent, high contrast draws no fills and no glow, and the export carries
// the print palette by default and the theme palette on request.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicDoc } from "../../src/ir/types";
import { OPACITY } from "../../webview/render/tokens";
import { hooks, post, postRender, ROOT, startHarness } from "./harness";

let harness: Awaited<ReturnType<typeof startHarness>>;
test.beforeAll(async () => {
  harness = await startHarness();
});
test.afterAll(async () => {
  await new Promise<void>((r) => harness.server.close(() => r()));
});

function goldenDoc(name: string): SchematicDoc {
  return JSON.parse(readFileSync(join(ROOT, "test", "golden", `${name}.ir.json`), "utf8")) as SchematicDoc;
}

interface Styled {
  filter: string;
  stroke: string;
  fill: string;
  strokeWidth: string;
  opacity: string;
  backgroundColor: string;
}
interface Win {
  getComputedStyle(el: unknown): Styled;
  document: { body: unknown };
}
// Runs inside the page: Playwright serialises the function, so it cannot close over helpers.
const style = (el: unknown): Styled => {
  const s = (globalThis as unknown as Win).getComputedStyle(el);
  return { filter: s.filter, stroke: s.stroke, fill: s.fill, strokeWidth: s.strokeWidth, opacity: s.opacity, backgroundColor: s.backgroundColor };
};
const opacityOf = (el: unknown): number => Number((globalThis as unknown as Win).getComputedStyle(el).opacity);
const filterOf = (el: unknown): string => (globalThis as unknown as Win).getComputedStyle(el).filter;
const bodyBackground = (): string => (globalThis as unknown as Win).getComputedStyle((globalThis as unknown as Win).document.body).backgroundColor;

test("v0.4: hovering a gate adds an accent glow and keeps its outline colour", async ({ page }) => {
  await page.goto(`${harness.url}/?theme=light`);
  await postRender(page, goldenDoc("7458"));
  const gate = page.locator("g.node-gate").first();
  const body = gate.locator(".gate-body");
  const before = await body.evaluate(style);
  expect((await gate.evaluate(style)).filter).toBe("none");
  await gate.hover();
  await expect.poll(() => gate.evaluate(filterOf)).toContain("drop-shadow");
  const after = await body.evaluate(style);
  expect(after.stroke).toBe(before.stroke);
  expect(after.strokeWidth).toBe(before.strokeWidth);
});

test("v0.4: focus mode fades everything outside the net to 35 percent", async ({ page }) => {
  await page.goto(`${harness.url}/?theme=light`);
  await postRender(page, goldenDoc("7458"));
  const wire = page.locator('g.net[data-net="net:p1a"] path.net-path');
  await wire.evaluate((el) => el.dispatchEvent(new (globalThis as unknown as { MouseEvent: new (t: string, i: object) => Event }).MouseEvent("mouseover", { bubbles: true })));
  const other = page.locator('g.net[data-net="net:p2a"]');
  await expect.poll(() => other.evaluate(opacityOf)).toBeCloseTo(OPACITY.faded, 2);
  const farGate = page.locator("g.node-gate").last();
  await expect.poll(() => farGate.evaluate(opacityOf)).toBeCloseTo(OPACITY.faded, 2);
});

test("v0.4: high contrast draws no fills, no glow and 2 px outlines", async ({ page }) => {
  await page.goto(`${harness.url}/?theme=hc`);
  await post(page, { type: "theme", generation: 0, theme: "highContrast" });
  await postRender(page, goldenDoc("7458"));
  const bg = await page.evaluate(bodyBackground);
  const body = page.locator("g.node-gate .gate-body").first();
  const s = await body.evaluate(style);
  expect(s.fill).toBe(bg);
  expect(s.strokeWidth).toBe("2px");
  expect((await page.locator("g.port .port-shape").first().evaluate(style)).fill).toBe(bg);
  const gate = page.locator("g.node-gate").first();
  await gate.hover();
  await page.waitForTimeout(200);
  expect((await gate.evaluate(style)).filter).toMatch(/^none$|0px/);
});

test("v0.4: the export uses the print palette by default and the theme palette when configured", async ({ page }) => {
  await page.goto(`${harness.url}/?theme=dark`);
  await postRender(page, goldenDoc("7458"));
  await post(page, { type: "export", generation: 0, format: "svg" });
  const exported = async (): Promise<string> => {
    const h = await hooks(page);
    const msgs = h.posted.filter((m) => (m as { type: string }).type === "export") as { data: string }[];
    return msgs[msgs.length - 1]?.data ?? "";
  };
  await expect.poll(exported).toContain('fill="#ffffff"');
  const print = await exported();
  expect(print).toContain("--rl-fg: #1f1f1f;");
  expect(print).toContain('transform="translate(24,24)"');
  expect(print).toContain("--rl-stroke-wire: 1.25px");
  await post(page, { type: "config", generation: 0, config: { exportPalette: "theme" } });
  await post(page, { type: "export", generation: 0, format: "svg" });
  // Custom properties resolve to their substituted text, not to rgb().
  await expect.poll(exported).toContain('fill="#1e1e1e"');
  const theme = await exported();
  expect(theme).toContain("--rl-fg: #d4d4d4;");
  expect(theme).toMatch(/--rl-mono: [^;]*monospace;/);
});
