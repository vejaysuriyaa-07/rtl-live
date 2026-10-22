// Lays out the golden IR with elkjs in node and checks the pure SVG renderer output.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ELK from "elkjs/lib/main.js";
import type { SchematicDoc } from "../../src/ir/types";
import { moduleToElk } from "../../webview/layout/toElk";
import type { ElkGraphOut } from "../../webview/layout/types";
import { renderModule } from "../../webview/render/svg";
import { ROOT } from "./helpers";

const GOLDEN = join(ROOT, "test", "golden");
type Elk = { layout(g: unknown): Promise<unknown> };
const elk = new (ELK as unknown as new () => Elk)();

function goldens(): string[] {
  return readdirSync(GOLDEN)
    .filter((f) => f.endsWith(".ir.json"))
    .sort();
}

async function render(name: string) {
  const doc = JSON.parse(readFileSync(join(GOLDEN, name), "utf8")) as SchematicDoc;
  const view = doc.modules[doc.top]!;
  const t0 = performance.now();
  const layout = (await elk.layout(moduleToElk(view))) as ElkGraphOut;
  const ms = performance.now() - t0;
  return { view, layout, svg: renderModule(view, layout), ms };
}

describe("svg renderer with real ELK layout", () => {
  for (const name of goldens()) {
    it(`${name}: every net wider than 1 bit carries a width label`, async () => {
      const { view, svg } = await render(name);
      for (const net of view.nets) {
        if (net.width <= 1 || net.sinks.length === 0 || !net.driver) continue;
        const re = new RegExp(`<g class="net bus" data-net="${net.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?<text class="bus-width"[^>]*>${net.width}</text>`);
        expect(svg.inner, `${name}: net ${net.id} (${net.width} bits) has no width label`).toMatch(re);
      }
      expect(svg.inner).not.toMatch(/https?:/);
    });
  }

  it("rippers are labelled with bit ranges", async () => {
    const { svg } = await render("vector2.ir.json");
    for (const l of ["[7:0]", "[15:8]", "[23:16]", "[31:24]"]) {
      expect(svg.inner).toContain(`<text class="ripper-label"`);
      expect(svg.inner).toContain(l);
    }
  });

  it("lays out every golden in under 100 ms (elkjs in node)", async () => {
    const times: Record<string, number> = {};
    for (const name of goldens()) {
      await render(name); // warm
      // Best of three: the suite runs in parallel workers and a single slow run is load, not layout cost.
      times[name] = Math.min((await render(name)).ms, (await render(name)).ms, (await render(name)).ms);
    }
    const worst = Math.max(...Object.values(times));
    console.log(`elk layout times (ms): ${Object.entries(times).map(([k, v]) => `${k.replace(".ir.json", "")}=${v.toFixed(1)}`).join(" ")}`);
    expect(worst).toBeLessThan(100);
  });
});
