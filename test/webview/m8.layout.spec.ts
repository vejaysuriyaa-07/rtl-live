// Layout comparison shots for the v0.3 readability work (bugs 14 and 15): one PNG per
// fixture in artifacts/v03-layout, tagged "before" or "after" through RTL_LIVE_SHOT_TAG.
import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicDoc } from "../../src/ir/types";
import { postRender, ROOT, startHarness } from "./harness";

const ART = join(ROOT, "artifacts", "v03-layout");
const TAG = process.env["RTL_LIVE_SHOT_TAG"] ?? "after";
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

for (const name of ["vectorgates", "7458", "module_add", "module_shift8"]) {
  test(`M8: ${name} layout shot (${TAG})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${harness.url}/?theme=light`);
    await postRender(page, goldenDoc(name));
    await page.screenshot({ path: join(ART, `${name}-${TAG}.png`) });
    expect(errors).toEqual([]);
  });
}
