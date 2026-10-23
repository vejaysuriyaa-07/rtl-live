// v0.4 visual proof: the same shots before and after the design pass. Writes into the
// directory named by RTL_LIVE_V04_DIR (default artifacts/v04-after): a contact sheet of
// every fixture in light and dark, and the key fixtures plus the Legend in light, dark
// and high contrast at the sidebar's nominal size.
import { expect, test } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SchematicDoc } from "../../src/ir/types";
import { renderModule } from "../../webview/render/svg";
import { layoutView } from "../accuracy/layout";
import { post, postRender, ROOT, startHarness, THEMES } from "./harness";

const OUT = resolve(ROOT, process.env["RTL_LIVE_V04_DIR"] ?? join("artifacts", "v04-after"));
export const KEY_FIXTURES = ["vectorgates", "7458", "module_add", "module_shift8", "counter4", "fsm_moore"];
const SHOT_THEMES = [
  { name: "light", kind: "light" },
  { name: "dark", kind: "dark" },
  { name: "hc", kind: "highContrast" },
] as const;
let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  harness = await startHarness();
});
test.afterAll(async () => {
  await new Promise<void>((r) => harness.server.close(() => r()));
});

function goldenDoc(name: string): SchematicDoc {
  return JSON.parse(readFileSync(join(ROOT, "test", "golden", `${name}.ir.json`), "utf8")) as SchematicDoc;
}

interface Doc {
  body: { scrollHeight: number };
}

for (const theme of ["light", "dark"] as const) {
  test(`v0.4: contact sheet (${theme})`, async ({ page }) => {
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
      :root{${THEMES[theme]}}
      body{margin:0;padding:12px;display:flex;flex-wrap:wrap;gap:12px;width:1176px;font-family:system-ui,sans-serif}
      figure{margin:0;width:280px;border:1px solid color-mix(in srgb, var(--rl-fg) 20%, transparent);border-radius:4px;padding:8px;display:flex;flex-direction:column;align-items:center;gap:4px}
      figcaption{font-size:11px;color:var(--rl-muted)}</style></head><body>${tiles.join("")}</body></html>`;
    const file = join(OUT, `contact-sheet-${theme}.html`);
    writeFileSync(file, html);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(`file://${file}`);
    expect(await page.locator("figure").count()).toBe(tiles.length);
    const height = await page.evaluate(() => (globalThis as unknown as { document: Doc }).document.body.scrollHeight);
    await page.setViewportSize({ width: 1200, height: Math.min(height + 24, 6000) });
    await page.screenshot({ path: join(OUT, `contact-sheet-${theme}.png`) });
  });
}

for (const theme of SHOT_THEMES) {
  for (const name of KEY_FIXTURES) {
    test(`v0.4: ${name} (${theme.name})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${harness.url}/?theme=${theme.name}`);
      await post(page, { type: "theme", generation: 0, theme: theme.kind });
      await postRender(page, goldenDoc(name));
      await page.screenshot({ path: join(OUT, `${name}-${theme.name}.png`) });
      expect(errors).toEqual([]);
    });
  }
  test(`v0.4: legend (${theme.name})`, async ({ page }) => {
    await page.goto(`${harness.url}/?theme=${theme.name}`);
    await post(page, { type: "theme", generation: 0, theme: theme.kind });
    await postRender(page, goldenDoc("vectorgates"));
    await page.keyboard.press("l");
    await expect(page.locator("#legend")).toBeVisible();
    await page.screenshot({ path: join(OUT, `legend-${theme.name}.png`) });
    await page.locator("#legend").screenshot({ path: join(OUT, `legend-panel-${theme.name}.png`) });
  });
}
