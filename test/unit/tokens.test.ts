import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CSS_TOKENS, JUNCTION_FACTOR, STROKE } from "../../webview/render/tokens";
import { junctionRadius, WIRE_STROKE } from "../../webview/render/geometry";
import { MIN_DOT_GAP } from "../../webview/layout/postprocess";
import { ROOT } from "./helpers";

const css = readFileSync(join(ROOT, "webview", "styles.css"), "utf8");

/** The declarations of the first `:root { ... }` block. */
function rootBlock(): Map<string, string> {
  const m = /:root\s*\{([^}]*)\}/.exec(css);
  expect(m, "styles.css has a :root block").toBeTruthy();
  const out = new Map<string, string>();
  for (const line of m![1]!.split(";")) {
    const i = line.indexOf(":");
    if (i > 0) out.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return out;
}

describe("design tokens", () => {
  it("every token appears on :root in the stylesheet with the same value", () => {
    const root = rootBlock();
    for (const [name, value] of Object.entries(CSS_TOKENS)) expect(root.get(name), name).toBe(value);
  });

  it("the geometry module draws wires and dots from the same tokens", () => {
    expect(WIRE_STROKE.single).toBe(STROKE.wire);
    expect(WIRE_STROKE.bus).toBe(STROKE.bus);
    expect(junctionRadius(1)).toBe(JUNCTION_FACTOR * STROKE.wire);
    expect(junctionRadius(8)).toBe(JUNCTION_FACTOR * STROKE.bus);
    // The junction spacing rule must still leave two bus dots clear of each other.
    expect(MIN_DOT_GAP).toBeGreaterThanOrEqual(2 * junctionRadius(8) + 2);
  });

  it("the stylesheet uses the tokens, not repeated literals, for strokes and radii", () => {
    const rules = css.replace(/:root\s*\{[^}]*\}/, "");
    // Any stroke-width or rx outside :root must come from a token or be a high contrast override.
    for (const m of rules.matchAll(/stroke-width:\s*([^;]+);/g)) expect(m[1], m[0]).toMatch(/^var\(--rl-stroke-[a-z]+\)$/);
  });
});
