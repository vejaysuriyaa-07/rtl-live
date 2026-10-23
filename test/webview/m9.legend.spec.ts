// Legend panel and tooltips in the real webview bundle (bug 18), light and dark.
import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicDoc } from "../../src/ir/types";
import { postRender, ROOT, startHarness } from "./harness";

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

for (const theme of ["light", "dark"]) {
  test(`M9: the Legend button opens a panel with every symbol (${theme})`, async ({ page }) => {
    await page.goto(`${harness.url}/?theme=${theme}`);
    await postRender(page, goldenDoc("vectorgates"));
    const btn = page.locator("button.legend-btn");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#legend")).toBeHidden();
    await btn.click();
    await expect(page.locator("#legend")).toBeVisible();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(await page.locator("#legend .legend-row").count()).toBeGreaterThanOrEqual(24);
    await expect(page.locator("#legend .legend-row[data-key='junction'] .legend-title")).toHaveText("Junction dot");
    await expect(page.locator("#legend .legend-row[data-key='any'] svg text.label")).toHaveText("any 1?");
    await page.screenshot({ path: join(ART, `m9-legend-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.locator("#legend")).toBeHidden();
  });
}

test("M9: vectorgates draws any-1 boxes, a logical tag, and tooltips on wires, dots and crossings", async ({ page }) => {
  await page.goto(`${harness.url}/?theme=light`);
  await postRender(page, goldenDoc("vectorgates"));
  const diagram = page.locator("#canvas > svg.schematic");
  await expect(diagram.locator("g.node-reduce text.label", { hasText: "any 1?" })).toHaveCount(2);
  await expect(diagram.locator("g.node-gate text.tag")).toHaveText("logical");
  const netTitles = await diagram.locator("g.net > title").allTextContents();
  expect(netTitles.length).toBeGreaterThan(0);
  for (const t of netTitles) expect(t).toMatch(/drawn as one line|One wire, 1 bit/);
  const dots = await diagram.locator("circle.junction > title").allTextContents();
  expect(dots.length).toBeGreaterThan(0);
  for (const t of dots) expect(t).toBe("Wires connect here.");
  const crossings = await diagram.locator("circle.crossing > title").allTextContents();
  for (const t of crossings) expect(t).toBe("These wires cross but do not connect.");
  const bubble = await diagram.locator("circle.bubble > title").first().textContent();
  expect(bubble).toBe("Flips the bit: 0 becomes 1, 1 becomes 0.");
  await page.screenshot({ path: join(ART, "m9-vectorgates-logical.png") });
});
