// Bug 1: "module top_module(" alone must draw a frame that holds its title, and
// Fit must never zoom above 100 percent.
import { describe, expect, it } from "vitest";
import { structuralToIr } from "../../src/structural/toIr";
import { FallbackStructuralParser } from "../../src/structural/fallbackScanner";
import { FIT_MAX_SCALE, textWidth } from "../../webview/render/geometry";
import { renderModule } from "../../webview/render/svg";
import { checkLayout, layoutView, textBoxes } from "../accuracy/layout";

describe("module frame", () => {
  it("grows to fit a long title when there is nothing else to draw", async () => {
    const file = new FallbackStructuralParser().parse("module top_module(");
    const doc = structuralToIr(file, { sourceUri: "t", generation: 1, top: "top_module" });
    const view = doc.modules["top_module"]!;
    expect(view.ports).toEqual([]);
    const layout = await layoutView(view);
    const svg = renderModule(view, layout, { frame: true });
    const title = textBoxes(svg.inner).find((t) => t.cls === "module-title")!;
    expect(title.text).toBe("top_module");
    expect(title.x + title.w).toBeLessThanOrEqual(svg.width - 4);
    expect(svg.width).toBeGreaterThanOrEqual(textWidth("top_module", 12 * 0.6) + 20);
    const rep = checkLayout(view, layout);
    expect(rep.labelsInside.ok, rep.labelsInside.issues.join("; ")).toBe(true);
    expect(rep.fit.ok, rep.fit.issues.join("; ")).toBe(true);
  });

  it("never zooms past 100 percent on Fit", () => {
    expect(FIT_MAX_SCALE).toBe(1);
  });
});
