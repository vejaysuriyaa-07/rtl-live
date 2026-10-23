// The legend must show every symbol the renderer can draw, each with a meaning.
import { describe, expect, it } from "vitest";
import type { NodeKind } from "../../src/ir/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { textBoxes } from "../accuracy/layout";
import { LEGEND_PIC_W, legendItems } from "../../webview/ui/legend";
import { ROOT } from "./helpers";

const ALL_KINDS: NodeKind[] = ["gate", "reduce", "mux", "pmux", "dff", "arith", "compare", "shift", "const", "instance", "blackbox", "split", "join", "cloud", "unknown"];

describe("legend", () => {
  it("covers every node kind plus ports, wires, buses, junctions, crossings and warnings", () => {
    const items = legendItems();
    const covered = new Set(items.flatMap((i) => i.kinds));
    for (const k of ALL_KINDS) expect(covered, k).toContain(k);
    for (const key of ["input", "output", "wire", "bus", "junction", "crossing", "not", "logical", "any", "join", "split", "warning"]) expect(items.map((i) => i.key)).toContain(key);
  });

  it("every item has a sample drawn with the symbol classes and a one-sentence meaning", () => {
    for (const item of legendItems()) {
      expect(item.title.length, item.key).toBeGreaterThan(2);
      expect(item.text, item.key).toMatch(/[.?!]$/);
      expect(item.text.split(/[.?!]\s/).length, item.key).toBeLessThanOrEqual(2);
      expect(item.svg, item.key).toMatch(/class="(net-path|port-shape|gate-body|body|ripper|junction|warn-badge)/);
      expect(item.width, item.key).toBeGreaterThan(0);
      expect(item.height, item.key).toBeGreaterThan(0);
      expect(new Set(legendItems().map((i) => i.key)).size).toBe(legendItems().length);
    }
  });

  it("samples keep every label inside their own box, apart, and within the picture column (bug 20)", () => {
    for (const item of legendItems()) {
      expect(item.width, `${item.key} wider than the picture column`).toBeLessThanOrEqual(LEGEND_PIC_W);
      const texts = textBoxes(item.svg);
      for (const t of texts) {
        const inside = t.x >= -0.5 && t.y >= -0.5 && t.x + t.w <= item.width + 0.5 && t.y + t.h <= item.height + 0.5;
        expect(inside, `${item.key}: "${t.text}" at ${Math.round(t.x)},${Math.round(t.y)} ${Math.round(t.w)}x${Math.round(t.h)} leaves the ${item.width}x${item.height} sample`).toBe(true);
      }
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          const a = texts[i]!;
          const b = texts[j]!;
          const apart = a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
          expect(apart, `${item.key}: "${a.text}" overlaps "${b.text}"`).toBe(true);
        }
      }
    }
  });

  it("the stylesheet gives the picture column the width the samples are sized for", () => {
    const css = readFileSync(join(ROOT, "webview", "styles.css"), "utf8");
    const w = /\.legend-pic \{[^}]*width: ([\d.]+)px/.exec(css)?.[1];
    expect(Number(w)).toBe(LEGEND_PIC_W);
  });
});
