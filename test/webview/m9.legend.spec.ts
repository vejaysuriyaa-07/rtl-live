// Legend panel and tooltips in the real webview bundle (bug 18), light and dark.
import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicDoc } from "../../src/ir/types";
import { postRender, ROOT, startHarness } from "./harness";

const ART = join(ROOT, "artifacts");
let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  mkdirSync(ART, { recursive: true });
  harness = await startHarness();
});
test.afterAll(async () => {
  await new Promise<void>((r) => harness.server.close(() => r()));
});

// The specs compile against the node library, so the browser objects used inside evaluate are typed here.
interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
interface Measurable {
  textContent: string | null;
  getBoundingClientRect(): Rect;
  getScreenCTM(): { a: number; d: number } | null;
  querySelector(sel: string): Measurable | null;
  querySelectorAll(sel: string): ArrayLike<Measurable>;
}
interface Win {
  getComputedStyle(el: unknown): { fontSize: string };
}

function goldenDoc(name: string): SchematicDoc {
  return JSON.parse(readFileSync(join(ROOT, "test", "golden", `${name}.ir.json`), "utf8")) as SchematicDoc;
}

for (const theme of ["light", "dark"]) {
  test(`M9: the Legend button opens a panel with every symbol (${theme})`, async ({ page }) => {
    await page.goto(`${harness.url}/?theme=${theme}`);
    await postRender(page, goldenDoc("vectorgates"));
    const btn = page.locator("button.legend-btn");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#legend")).toBeHidden();
    await btn.click();
    await expect(page.locator("#legend")).toBeVisible();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(await page.locator("#legend .legend-row").count()).toBeGreaterThanOrEqual(24);
    await expect(page.locator("#legend .legend-row[data-key='junction'] .legend-title")).toHaveText("Junction dot");
    await expect(page.locator("#legend .legend-row[data-key='any'] svg text.label")).toHaveText("any 1?");
    await page.screenshot({ path: join(ART, `m9-legend-${theme}.png`) });
    await page.locator("#legend").screenshot({ path: join(ART, `m9-legend-panel-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.locator("#legend")).toBeHidden();
  });

  test(`M9: legend samples draw at the diagram's scale with every label inside the picture column (${theme})`, async ({ page }) => {
    await page.goto(`${harness.url}/?theme=${theme}`);
    await postRender(page, goldenDoc("vectorgates"));
    await page.locator("button.legend-btn").click();
    await expect(page.locator("#legend")).toBeVisible();
    const diagramLabel = page.locator("#canvas > svg.schematic text.ripper-label").first();
    const diagramFont = await diagramLabel.evaluate((el) => (globalThis as unknown as Win).getComputedStyle(el).fontSize);
    const rows = page.locator("#legend .legend-row");
    const n = await rows.count();
    expect(n).toBeGreaterThanOrEqual(24);
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const key = await row.getAttribute("data-key");
      const m = await row.evaluate((node) => {
        const el = node as unknown as Measurable;
        const rect = (r: Rect): Rect => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        const svg = el.querySelector("svg")!;
        const ctm = svg.getScreenCTM()!;
        return {
          scaleX: ctm.a,
          scaleY: ctm.d,
          pic: rect(el.querySelector(".legend-pic")!.getBoundingClientRect()),
          text: rect(el.querySelector(".legend-text")!.getBoundingClientRect()),
          // A label's text content includes its tooltip title; drop it.
          labels: Array.from(svg.querySelectorAll("text")).map((t) => ({ text: (t.textContent ?? "").replace(t.querySelector("title")?.textContent ?? "", ""), font: (globalThis as unknown as Win).getComputedStyle(t).fontSize, ...rect(t.getBoundingClientRect()) })),
        };
      });
      // One SVG unit is one CSS pixel, as in the diagram at 100 percent.
      expect(m.scaleX, `${key} scale`).toBeCloseTo(1, 2);
      expect(m.scaleY, `${key} scale`).toBeCloseTo(1, 2);
      for (const l of m.labels) {
        const where = `${key}: "${l.text}" at ${Math.round(l.left)}..${Math.round(l.right)} (pic ${Math.round(m.pic.left)}..${Math.round(m.pic.right)}, text from ${Math.round(m.text.left)})`;
        expect(l.left >= m.pic.left - 0.5 && l.right <= m.pic.right + 0.5, `${where} leaves the picture column`).toBe(true);
        expect(l.right <= m.text.left + 0.5, `${where} overlaps the text column`).toBe(true);
        expect(l.top >= m.pic.top - 0.5 && l.bottom <= m.pic.bottom + 0.5, `${where} leaves the row`).toBe(true);
      }
      if (key === "split" || key === "join") {
        expect(m.labels.map((l) => l.text).sort()).toEqual(["[2:0]", "[5:3]"]);
        for (const l of m.labels) expect(l.font, `${key} label font`).toBe(diagramFont);
        await row.scrollIntoViewIfNeeded();
        await row.screenshot({ path: join(ART, `m9-legend-${key}-${theme}.png`) });
      }
    }
  });
}

test("M9: vectorgates draws any-1 boxes, a logical tag, and tooltips on wires, dots and crossings", async ({ page }) => {
  await page.goto(`${harness.url}/?theme=light`);
  await postRender(page, goldenDoc("vectorgates"));
  const diagram = page.locator("#canvas > svg.schematic");
  await expect(diagram.locator("g.node-reduce text.label", { hasText: "any 1?" })).toHaveCount(2);
  await expect(diagram.locator("g.node-gate text.tag")).toHaveText("logical");
  const netTitles = await diagram.locator("g.net > title").allTextContents();
  expect(netTitles.length).toBeGreaterThan(0);
  for (const t of netTitles) expect(t).toMatch(/drawn as one line|One wire, 1 bit/);
  const dots = await diagram.locator("circle.junction > title").allTextContents();
  expect(dots.length).toBeGreaterThan(0);
  for (const t of dots) expect(t).toBe("Wires connect here.");
  const crossings = await diagram.locator("circle.crossing > title").allTextContents();
  for (const t of crossings) expect(t).toBe("These wires cross but do not connect.");
  const bubble = await diagram.locator("circle.bubble > title").first().textContent();
  expect(bubble).toBe("Flips the bit: 0 becomes 1, 1 becomes 0.");
  await page.screenshot({ path: join(ART, "m9-vectorgates-logical.png") });
});
