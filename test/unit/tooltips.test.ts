// Bug 18: every drawn element explains itself in one plain sentence and names its source line.
// Bug 17: logical operators on buses are drawn as "any 1?" boxes into a 1-bit gate.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ModuleView, SchematicDoc } from "../../src/ir/types";
import { expandLogicalGates, ANY_ONE, ALL_ZERO } from "../../webview/render/logical";
import { renderModule } from "../../webview/render/svg";
import { nodeTooltip, portTooltip, TIP } from "../../webview/render/tooltips";
import { layoutView } from "../accuracy/layout";
import { ROOT } from "./helpers";

const GOLDEN = join(ROOT, "test", "golden");

function goldens(): { name: string; view: ModuleView }[] {
  return readdirSync(GOLDEN)
    .filter((f) => f.endsWith(".ir.json"))
    .map((f) => {
      const doc = JSON.parse(readFileSync(join(GOLDEN, f), "utf8")) as SchematicDoc;
      return { name: f, view: doc.modules[doc.top]! };
    })
    .filter((g) => g.view !== undefined);
}

/** Elements that must carry a tooltip, as [selector name, regex over the markup, extractor of the title]. */
function titledElements(inner: string): { kind: string; title: string }[] {
  const out: { kind: string; title: string }[] = [];
  const groups = /<g class="(node|port|net)[^"]*"[^>]*>([\s\S]*?)<title>([^<]*)<\/title><\/g>/g;
  for (const m of inner.matchAll(groups)) out.push({ kind: m[1]!, title: m[3]! });
  const circles = /<circle class="(junction|crossing|bubble|pin-hit)"[^>]*>(?:<title>([^<]*)<\/title>)?/g;
  for (const m of inner.matchAll(circles)) out.push({ kind: m[1]!, title: m[2] ?? "" });
  const marks = /<g class="(bus-mark|warn)"[^>]*>[\s\S]*?<title>([^<]*)<\/title>/g;
  for (const m of inner.matchAll(marks)) out.push({ kind: m[1]!, title: m[2]! });
  const tris = /<path class="(clk-tri)"[^>]*>(?:<title>([^<]*)<\/title>)?/g;
  for (const m of inner.matchAll(tris)) out.push({ kind: m[1]!, title: m[2] ?? "" });
  return out;
}

describe("tooltips on every element", () => {
  it("every node, port, net, junction, crossing, bubble, slash and clock triangle in every golden has a sentence", async () => {
    const seen = new Set<string>();
    const missing: string[] = [];
    for (const { name, view } of goldens()) {
      const inner = renderModule(view, await layoutView(view), { frame: true }).inner;
      for (const el of titledElements(inner)) {
        seen.add(el.kind);
        if (!/[A-Za-z]{3,}.*[.?!]/.test(el.title)) missing.push(`${name}: ${el.kind} "${el.title.slice(0, 40)}"`);
      }
      // Every group that can carry a title does.
      const untitledNodes = (inner.match(/<g class="node[^"]*"[^>]*>(?:(?!<\/g>)[\s\S])*?<\/g>/g) ?? []).filter((g) => !g.includes("<title>"));
      if (untitledNodes.length > 0) missing.push(`${name}: ${untitledNodes.length} node(s) without a tooltip`);
    }
    expect(missing).toEqual([]);
    for (const kind of ["node", "port", "net", "junction", "bubble", "bus-mark", "clk-tri", "crossing", "pin-hit"]) expect(seen, kind).toContain(kind);
  });

  it("quotes the source line when the text is known", () => {
    const view = goldens().find((g) => g.name === "vectorgates.ir.json")!.view;
    const gate = view.nodes.find((n) => n.kind === "gate" && n.info?.["logical"] === "1")!;
    const lines = readFileSync(join(ROOT, "test", "fixtures", "hdlbits", "vectorgates.v"), "utf8").split("\n");
    const tip = nodeTooltip(gate, lines);
    expect(tip).toContain("Logical OR (||)");
    expect(tip).toContain(TIP.logical);
    expect(tip).toContain("from line 4: assign out_or_logical = a || b;");
    expect(nodeTooltip(gate, undefined)).toContain("from line 4");
    const port = view.ports.find((p) => p.name === "out_not")!;
    expect(portTooltip(port, "out_not[5:0]", lines)).toBe(`output out_not[5:0]\n${TIP.output}\n${TIP.bus(6)}\nfrom line 2: output [2:0] out_or_bitwise, output out_or_logical, output [5:0] out_not);`);
  });

  it("names the symbols the table in BUGS.md lists", () => {
    const vg = goldens().find((g) => g.name === "vectorgates.ir.json")!.view;
    const drawn = expandLogicalGates(vg);
    const texts = drawn.nodes.map((n) => nodeTooltip(n, undefined));
    expect(texts.some((t) => t.includes(TIP.bitwise))).toBe(true);
    expect(texts.some((t) => t.includes(TIP.anyOne))).toBe(true);
    expect(texts.some((t) => t.includes(TIP.join))).toBe(true);
    const counter = goldens().find((g) => g.name === "counter4.ir.json")!.view;
    const ff = counter.nodes.find((n) => n.kind === "dff")!;
    expect(nodeTooltip(ff, undefined)).toContain(TIP.dff);
    const latch = goldens().find((g) => g.name === "latch_en.ir.json")!.view;
    expect(nodeTooltip(latch.nodes.find((n) => n.kind === "dff")!, undefined)).toContain(TIP.latch);
    const mux = goldens().find((g) => g.name === "mux4_case.ir.json")!.view;
    expect(nodeTooltip(mux.nodes.find((n) => n.kind === "pmux" || n.kind === "mux")!, undefined)).toContain(TIP.mux);
    const bb = goldens().find((g) => g.name === "module_add.ir.json")!.view;
    expect(nodeTooltip(bb.nodes.find((n) => n.kind === "blackbox")!, undefined)).toContain(TIP.blackbox);
    expect(nodeTooltip(bb.nodes.find((n) => n.kind === "const")!, undefined)).toContain("A fixed value from your code: 1'b0.");
  });
});

describe("logical operators drawn as reduce boxes", () => {
  it("vectorgates: a || b on 3-bit inputs becomes two any-1 boxes into a 1-bit OR tagged logical", () => {
    const view = goldens().find((g) => g.name === "vectorgates.ir.json")!.view;
    const drawn = expandLogicalGates(view);
    const boxes = drawn.nodes.filter((n) => n.kind === "reduce" && n.label === ANY_ONE);
    expect(boxes).toHaveLength(2);
    expect(boxes.map((b) => b.width)).toEqual([3, 3]);
    const gate = drawn.nodes.find((n) => n.kind === "gate" && n.info?.["logical"] === "1")!;
    expect(gate.pins.filter((p) => p.direction === "in").map((p) => p.width)).toEqual([1, 1]);
    for (const b of boxes) {
      const out = drawn.nets.find((n) => n.id === b.pins[1]!.net)!;
      expect(out.width).toBe(1);
      expect(out.sinks).toEqual([{ node: gate.id, pin: b.info!["operand"] }]);
      const input = drawn.nets.find((n) => n.id === b.pins[0]!.net)!;
      expect(input.sinks.some((s) => s.node === b.id)).toBe(true);
      expect(input.sinks.some((s) => s.node === gate.id)).toBe(false);
    }
    // The IR itself is untouched.
    expect(view.nodes.some((n) => n.kind === "reduce")).toBe(false);
    expect(expandLogicalGates(drawn)).toBe(drawn);
  });

  it("!a on a bus is one all-0 box; 1-bit logical inputs keep the plain gate", () => {
    const view = goldens().find((g) => g.name === "logic_ops.ir.json")!.view;
    const drawn = expandLogicalGates(view);
    const notBox = drawn.nodes.filter((n) => n.kind === "reduce" && n.label === ALL_ZERO);
    expect(notBox.length).toBeGreaterThanOrEqual(1);
    expect(notBox[0]!.op).toBe("nor");
    const bl = goldens().find((g) => g.name === "bitwise_vs_logical.ir.json")!.view;
    const onebit = bl.nodes.filter((n) => n.kind === "gate" && n.info?.["logical"] === "1" && n.pins.every((p) => p.width === 1));
    const drawnBl = expandLogicalGates(bl);
    for (const g of onebit) expect(drawnBl.nodes.find((n) => n.id === g.id)!.kind).toBe("gate");
  });

  it("the drawing shows the tag, the box label and the glyph", async () => {
    const view = goldens().find((g) => g.name === "vectorgates.ir.json")!.view;
    const inner = renderModule(view, await layoutView(view)).inner;
    expect(inner).toContain('class="tag"');
    expect(inner).toContain(">logical</text>");
    expect((inner.match(/>any 1\?</g) ?? []).length).toBe(2);
    expect(inner).toContain(">||</text>");
  });
});
