import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { startHarness, postRender, post, ROOT } from "./harness";
import { structuralDoc } from "./docs";

const ART = join(ROOT, "artifacts");
let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness();
});
test.afterAll(async () => {
  await new Promise<void>((r) => harness.server.close(() => r()));
});

test("M7: ghost ports of a stale overlay are drawn muted and keep the old nodes", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  const doc = structuralDoc("7458.v");
  const view = doc.modules["top_module"]!;
  view.ports.push({ name: "extra", direction: "input", width: 1, src: [], ghost: "added" });
  view.ports[0]!.ghost = "removed";
  await postRender(page, doc);
  await post(page, { type: "status", generation: 1, status: { fidelity: "stale", backend: "native", message: "last good diagram; 1 port added, 1 removed" } });
  await expect(page.locator('[data-port="extra"].ghost-added')).toHaveCount(1);
  await expect(page.locator('[data-port="p1a"].ghost-removed')).toHaveCount(1);
  await expect(page.locator(".badge")).toHaveText("Stale");
  await expect(page.locator(".status-text")).toContainText("1 port added");
  await page.screenshot({ path: join(ART, "m7-stale-overlay.png") });
});

test("M7: a hint with an action shows a button that posts setLanguage", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  await post(page, { type: "hint", generation: 0, hint: { message: "Untitled-1 is Plain Text but looks like Verilog.", action: { label: "Set language to Verilog", command: "setLanguage" } } });
  await expect(page.locator("#hint")).toBeVisible();
  await page.locator("#hint button").click();
  const posted = await page.evaluate(() => (globalThis as unknown as { __rtlLiveTestHooks: { posted: unknown[] } }).__rtlLiveTestHooks.posted);
  expect(JSON.stringify(posted)).toContain('"setLanguage"');
  await post(page, { type: "hint", generation: 0, hint: null });
  await expect(page.locator("#hint")).toBeHidden();
});

test("M7: a structural status with editing shows the Editing badge", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  await post(page, { type: "status", generation: 1, status: { fidelity: "structural", editing: true, backend: "native", message: "1 module, 1 syntax error" } });
  await expect(page.locator(".badge")).toHaveText("Editing");
  await post(page, { type: "status", generation: 2, status: { fidelity: "structural", editing: false, backend: "native" } });
  await expect(page.locator(".badge")).toHaveText("Structural");
});
