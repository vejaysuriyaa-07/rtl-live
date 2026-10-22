import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startHarness, postRender, hooks, ROOT } from "./harness";
import type { SchematicDoc } from "../../src/ir/types";

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

test("M4: module_add_full drills into add16 and the breadcrumb returns to top", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  await postRender(page, goldenDoc("module_add_full"));
  await expect(page.locator("text.module-title")).toHaveText("top_module");
  const inst = page.locator('g.node-instance[data-drill="add16"]').first();
  await expect(inst).toHaveCount(1);
  await page.screenshot({ path: join(ART, "m4-module_add_full-top.png") });
  await inst.dblclick();
  await expect(page.locator("text.module-title")).toHaveText("add16");
  expect(await page.locator("g.node-arith.op-add").count()).toBeGreaterThanOrEqual(1);
  await expect(page.locator("#breadcrumb")).toBeVisible();
  await expect(page.locator("#breadcrumb .crumb")).toHaveCount(2);
  await page.screenshot({ path: join(ART, "m4-module_add_full-add16.png") });
  const h = await hooks(page);
  expect(h.state.stack).toEqual(["add16"]);
  await page.locator("#breadcrumb .crumb").first().click();
  await expect(page.locator("text.module-title")).toHaveText("top_module");
  await expect(page.locator("#breadcrumb")).toBeHidden();
});

test("M4: black boxes are dashed and carry the not-defined tooltip", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  await postRender(page, goldenDoc("module_add"));
  const boxes = page.locator("g.node-blackbox");
  await expect(boxes).toHaveCount(2);
  const title = await boxes.first().locator("title").textContent();
  expect(title).toContain("not defined in this file");
  await expect(boxes.first().locator("rect.body.dashed")).toHaveCount(1);
  await expect(page.locator("g.node-const")).toHaveCount(1);
  await page.screenshot({ path: join(ART, "m4-module_add.png") });
});

test("M4: the top dropdown lists both modules of multi_module", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  await postRender(page, goldenDoc("multi_module"));
  const options = await page.locator("select.tb-select option").allTextContents();
  expect(options).toEqual(["inv", "top_module"]);
  await expect(page.locator("select.tb-select")).toHaveValue("top_module");
  await page.screenshot({ path: join(ART, "m4-multi_module.png") });
});

for (const name of ["module", "module_pos", "module_name", "module_shift"]) {
  test(`M4: ${name} screenshot`, async ({ page }) => {
    await page.goto(`${harness.url}/`);
    await postRender(page, goldenDoc(name));
    await expect(page.locator("g.node-blackbox").first()).toBeVisible();
    await page.screenshot({ path: join(ART, `m4-${name}.png`) });
  });
}
