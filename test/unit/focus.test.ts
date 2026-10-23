// Focus mode: hovering a wire lights its whole net; hovering a symbol lights every net on its pins.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SchematicDoc } from "../../src/ir/types";
import { focusNets, focusSymbols } from "../../webview/interaction/focus";
import { ROOT } from "./helpers";

const doc = JSON.parse(readFileSync(join(ROOT, "test", "golden", "7458.ir.json"), "utf8")) as SchematicDoc;
const view = doc.modules["top_module"]!;

describe("focus mode", () => {
  it("a wire focuses its own net and the symbols at both ends", () => {
    const nets = focusNets(view, { net: "net:p1a" });
    expect([...nets]).toEqual(["net:p1a"]);
    const symbols = focusSymbols(view, nets);
    expect(symbols.has("port:p1a")).toBe(true);
    expect([...symbols].some((s) => s.startsWith("gate:and"))).toBe(true);
    expect(symbols.size).toBe(2);
  });

  it("a gate focuses every net on its pins; a port focuses the nets it drives or reads", () => {
    const gate = view.nodes.find((n) => n.kind === "gate" && n.op === "and" && n.pins.length === 4)!;
    const nets = focusNets(view, { node: gate.id });
    expect(nets.size).toBe(4);
    for (const p of gate.pins) expect(nets.has(p.net!)).toBe(true);
    expect(focusNets(view, { port: "p1y" }).has("net:p1y")).toBe(true);
    expect(focusNets(view, { port: "nothing" }).size).toBe(0);
  });
});
