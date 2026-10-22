import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { startHarness, postRender, hooks, ROOT } from "./harness";
import { structuralDoc } from "./docs";
import { FallbackStructuralParser } from "../../src/structural/fallbackScanner";
import { structuralToIr } from "../../src/structural/toIr";

const ART = join(ROOT, "artifacts");

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  mkdirSync(ART, { recursive: true });
  harness = await startHarness();
});
test.afterAll(async () => {
  await new Promise<void>((r) => harness.server.close(() => r()));
});

test("M1: wire.v shows the module box with ports in and out", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(`${harness.url}/`);
  await postRender(page, structuralDoc("wire.v"));
  await expect(page.locator('[data-port="in"]')).toHaveCount(1);
  await expect(page.locator('[data-port="out"]')).toHaveCount(1);
  await expect(page.locator("text.module-title")).toHaveText("top_module");
  await page.screenshot({ path: join(ART, "m1-wire.png") });
  const h = await hooks(page);
  expect(JSON.stringify(h.posted)).toContain('"ready"');
  expect(logs.filter((l) => l.startsWith("pageerror"))).toEqual([]);
});

test("M1: a partial header still renders a module box", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  const file = new FallbackStructuralParser().parse("module top_module(input a, output");
  const doc = structuralToIr(file, { sourceUri: "p2", generation: 1, top: "top_module" });
  await postRender(page, doc);
  await expect(page.locator('[data-port="a"]')).toHaveCount(1);
  await expect(page.locator("text.module-title")).toHaveText("top_module");
});

test("M1: layout engine mode is reported", async ({ page }) => {
  await page.goto(`${harness.url}/`);
  await postRender(page, structuralDoc("7458.v"));
  const h = await hooks(page);
  expect(["worker", "main"]).toContain(h.elk.mode);
  console.log(`elk mode: ${h.elk.mode}`);
  await page.screenshot({ path: join(ART, "m1-7458-structural.png") });
});
