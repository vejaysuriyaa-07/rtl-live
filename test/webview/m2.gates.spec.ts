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

/** Golden IR files double as render fixtures so Playwright needs no yosys. */
function goldenDoc(name: string): SchematicDoc {
  return JSON.parse(readFileSync(join(ROOT, "test", "golden", `${name}.ir.json`), "utf8")) as SchematicDoc;
}

for (const name of ["7458", "gates4", "xnor_misc", "vectorgates", "notgate"]) {
  test(`M2: ${name} renders gate symbols`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${harness.url}/`);
    await postRender(page, goldenDoc(name));
    const gates = page.locator("g.node-gate, g.node-reduce");
    expect(await gates.count()).toBeGreaterThan(0);
    await expect(page.locator("g.node-gate .gate-body, g.node-reduce .gate-body").first()).toBeVisible();
    await page.screenshot({ path: join(ART, `m2-${name}.png`) });
    expect(errors).toEqual([]);
  });
}

test("M2: 7458 shows two 3-input ANDs", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  await postRender(page, goldenDoc("7458"));
  const threeInput = await page.locator("g.node-gate.op-and").evaluateAll((els) => els.filter((e) => e.querySelectorAll("circle.pin").length === 4).length);
  expect(threeInput).toBe(2);
});
