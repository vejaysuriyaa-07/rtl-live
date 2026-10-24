// Renders media/icon.svg to media/icon.png (128x128) with Playwright's Chromium.
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const svg = readFileSync(`${root}/media/icon.svg`, "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator("svg").screenshot({ path: `${root}/media/icon.png`, omitBackground: true });
await browser.close();
console.log("wrote media/icon.png");
