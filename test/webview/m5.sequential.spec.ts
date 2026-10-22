import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startHarness, postRender, ROOT } from "./harness";
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

for (const name of ["mux2_always", "module_shift8", "dff_async", "counter4", "shift4", "fsm_moore", "arith_compare"]) {
  test(`M5: ${name} renders without unknown boxes`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${harness.url}/`);
    await postRender(page, goldenDoc(name));
    await expect(page.locator("g.node-unknown")).toHaveCount(0);
    await page.screenshot({ path: join(ART, `m5-${name}.png`) });
    expect(errors).toEqual([]);
  });
}

test("M5: counter4 has a DFF with a clock triangle and the adder feedback", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  await postRender(page, goldenDoc("counter4"));
  await expect(page.locator("g.node-dff .clk-tri")).toHaveCount(1);
  await expect(page.locator("g.node-arith.op-add")).toHaveCount(1);
  await expect(page.locator("g.node-mux")).toHaveCount(1);
});

test("M5: fsm_moore state register tooltip lists A and B", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  await postRender(page, goldenDoc("fsm_moore"));
  const title = await page.locator("g.node-dff title").textContent();
  expect(title).toContain("states: A = 1'b0, B = 1'b1");
});
