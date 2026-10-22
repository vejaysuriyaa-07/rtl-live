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

for (const name of ["vector0", "vector2", "vectorr", "vector3", "vector4", "vector5"]) {
  test(`M3: ${name} renders buses and rippers`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${harness.url}/`);
    await postRender(page, goldenDoc(name));
    expect(await page.locator("g.net.bus").count()).toBeGreaterThan(0);
    expect(await page.locator("text.bus-width").count()).toBeGreaterThan(0);
    await page.screenshot({ path: join(ART, `m3-${name}.png`) });
    expect(errors).toEqual([]);
  });
}

test("M3: vector2 shows the four rippers", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  await postRender(page, goldenDoc("vector2"));
  const labels = await page.locator("text.ripper-label").allTextContents();
  for (const l of ["[7:0]", "[15:8]", "[23:16]", "[31:24]"]) expect(labels.join(" ")).toContain(l);
});
