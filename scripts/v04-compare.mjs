// Side-by-side before/after images for the v0.4 design pass.
// Reads artifacts/v04-before and artifacts/v04-after (written by test/webview/v04.visual.spec.ts
// with RTL_LIVE_V04_DIR) and writes artifacts/v04-after/compare-<name>-<theme>.png.
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const before = join(root, "artifacts", "v04-before");
const after = join(root, "artifacts", "v04-after");
const names = ["vectorgates", "7458", "module_add", "module_shift8", "counter4", "fsm_moore", "legend"];
const themes = ["light", "dark"];

const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

mkdirSync(after, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
let written = 0;
for (const name of names) {
  for (const theme of themes) {
    const a = join(before, `${name}-${theme}.png`);
    const b = join(after, `${name}-${theme}.png`);
    if (!existsSync(a) || !existsSync(b)) continue;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{margin:0;padding:12px;background:#777;font:12px system-ui,sans-serif;color:#fff;display:flex;gap:12px}
      figure{margin:0;display:flex;flex-direction:column;gap:6px}
      img{display:block;width:900px;height:600px;border:1px solid #444}
      figcaption{text-align:center}
    </style></head><body>
      <figure><img src="${dataUri(a)}"><figcaption>${name} ${theme}: before (0.3.1)</figcaption></figure>
      <figure><img src="${dataUri(b)}"><figcaption>${name} ${theme}: after (0.4.0)</figcaption></figure>
    </body></html>`;
    await page.setContent(html);
    await page.setViewportSize({ width: 900 * 2 + 12 * 3, height: 600 + 24 + 24 });
    await page.screenshot({ path: join(after, `compare-${name}-${theme}.png`), fullPage: true });
    written++;
  }
}
await browser.close();
console.log(`wrote ${written} comparison images to ${after}`);
