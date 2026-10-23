// Render budget: the SVG renderer must turn a 100-node layout into markup well inside one
// frame. Runs on its own (npm run test:perf) so other test files do not share the CPU with
// the measurement. ELK itself runs in a worker and is measured separately (NOTES.md, v0.4).
import { describe, expect, it } from "vitest";
import { renderModule } from "../../webview/render/svg";
import { bigView } from "../unit/bigView";
import { layoutView } from "../accuracy/layout";

describe("render budget", () => {
  it("renders a 100-node layout to markup in under 16 ms (best of 40)", async () => {
    const view = bigView(100);
    const layout = await layoutView(view);
    renderModule(view, layout, { frame: true });
    // The best of 40 runs is the renderer's own cost; the median also shows how busy the
    // machine was (NOTES.md, v0.4, records both on a quiet machine).
    const walls: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      renderModule(view, layout, { frame: true });
      walls.push(performance.now() - t0);
    }
    walls.sort((a, b) => a - b);
    const best = walls[0]!;
    console.log(`render 100 nodes: best ${best.toFixed(2)} ms, median ${walls[20]!.toFixed(2)} ms, max ${walls[39]!.toFixed(2)} ms, nodes ${view.nodes.length}, edges ${layout.edges.length}`);
    expect(best).toBeLessThan(16);
  }, 60_000);
});
