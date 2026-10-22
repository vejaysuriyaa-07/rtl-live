import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { startHarness, postRender, post, ROOT } from "./harness";
import { structuralDoc } from "./docs";
import { FallbackStructuralParser } from "../../src/structural/fallbackScanner";
import { structuralToIr } from "../../src/structural/toIr";

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

test("M7: the view toggle posts setView and the badge names the view", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  await post(page, { type: "status", generation: 1, status: { fidelity: "synthesized", view: "rtl", backend: "native" } });
  await expect(page.locator(".badge")).toHaveText("RTL view");
  await expect(page.locator(".view-btn.active")).toHaveText("RTL");
  await page.locator(".view-btn", { hasText: "Gate" }).click();
  const posted = await page.evaluate(() => (globalThis as unknown as { __rtlLiveTestHooks: { posted: unknown[] } }).__rtlLiveTestHooks.posted);
  expect(JSON.stringify(posted)).toContain('"setView"');
  await post(page, { type: "status", generation: 2, status: { fidelity: "synthesized", view: "gate", backend: "native" } });
  await expect(page.locator(".badge")).toHaveText("Gate view");
  await expect(page.locator(".view-btn.active")).toHaveText("Gate");
});

test("M7: a latch carries a warning badge and no clock triangle; a flop has the triangle", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  const doc = JSON.parse(readFileSync(join(ROOT, "test", "golden", "latch_vs_flop.ir.json"), "utf8"));
  await postRender(page, doc);
  await expect(page.locator('g.node-dff.op-dlatch .warn-badge')).toHaveCount(1);
  await expect(page.locator('g.node-dff.op-dlatch .clk-tri')).toHaveCount(0);
  await expect(page.locator('g.node-dff.op-dff .clk-tri')).toHaveCount(1);
  await expect(page.locator('g.node-dff.op-dff .warn-badge')).toHaveCount(0);
  await page.screenshot({ path: join(ART, "m7-latch-vs-flop.png") });
});

test("M7: a multiply driven net and a combinational loop carry warning badges on the wire", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  for (const [name, net] of [
    ["multi_driver.v", "y"],
    ["comb_loop.v", "a"],
  ]) {
    const file = new FallbackStructuralParser().parse(readFileSync(join(ROOT, "test", "fixtures", "semantics", name!), "utf8"));
    await postRender(page, structuralToIr(file, { sourceUri: name!, generation: 1, top: "top_module" }));
    await expect(page.locator(`g.net.warn[data-net="net:${net}"] .warn-badge`)).toHaveCount(1);
  }
  await page.screenshot({ path: join(ART, "m7-comb-loop.png") });
});
