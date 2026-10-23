// The accuracy checks must be able to fail: each detector is fed a known-bad
// input here, so a green report means the design is right, not the checker blind.
import { describe, expect, it } from "vitest";
import type { ModuleView, SchematicDoc } from "../../src/ir/types";
import { docToVerilog, ExportError } from "../../src/ir/toVerilog";
import type { ElkGraphOut } from "../../webview/layout/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIT_MAX_SCALE, junctionRadius, WIRE_STROKE } from "../../webview/render/geometry";
import { fmt } from "../../webview/render/svg";
import { HDLBITS, ROOT, makeTreeSitterParser, readFixture } from "../unit/helpers";
import { disposeTestBackend, synthFixture } from "../unit/synthHelpers";
import { buildTestbench, checkEquivalence, clockInputs, compareOutputs, icarusAvailable } from "./equivalence";
import { checkLayout, junctionDots, layoutView, textBoxes } from "./layout";

async function synthDoc(name: string): Promise<{ doc: SchematicDoc; text: string; file: ReturnType<Awaited<ReturnType<typeof makeTreeSitterParser>>["parse"]> }> {
  const parser = await makeTreeSitterParser();
  const text = readFixture(HDLBITS, name);
  const res = await synthFixture(parser, text, name);
  expect(res.ok).toBe(true);
  return { doc: res.doc!, text, file: parser.parse(text) };
}

describe("L1 harness", () => {
  it("icarus is installed", () => {
    expect(icarusAvailable()).toBe(true);
  });

  it("detects a wrong gate (and swapped for or) in 7458", async () => {
    const { doc, text, file } = await synthDoc("7458.v");
    const good = checkEquivalence({ name: "7458.v", source: text, file, doc });
    expect(good.ok, good.reason).toBe(true);
    const bad = structuredClone(doc);
    const g = bad.modules["top_module"]!.nodes.find((n) => n.kind === "gate" && n.op === "and")!;
    g.op = "or";
    const res = checkEquivalence({ name: "7458.v", source: text, file, doc: bad });
    expect(res.ok).toBe(false);
    expect(res.mismatches).toBeGreaterThan(0);
    expect(res.reason).toMatch(/differs at vector/);
    disposeTestBackend();
  });

  it("detects a dropped inversion bubble", async () => {
    const { doc, text, file } = await synthDoc("xnor_misc.v");
    const bad = structuredClone(doc);
    const g = bad.modules["top_module"]!.nodes.find((n) => n.kind === "gate" && n.op === "xnor")!;
    g.op = "xor";
    expect(checkEquivalence({ name: "xnor_misc.v", source: text, file, doc: bad }).ok).toBe(false);
    disposeTestBackend();
  });

  it("detects a wrong reset value on a clocked design", async () => {
    const { doc, text, file } = await synthDoc("dff_async.v");
    const bad = structuredClone(doc);
    const ff = bad.modules["top_module"]!.nodes.find((n) => n.kind === "dff")!;
    ff.info = { ...ff.info, reset: "async, value 11111111" };
    const res = checkEquivalence({ name: "dff_async.v", source: text, file, doc: bad });
    expect(res.clocks).toEqual(["clk"]);
    expect(res.ok).toBe(false);
    disposeTestBackend();
  });

  it("refuses to export a logic cloud and says so", () => {
    const view: ModuleView = {
      name: "m",
      ports: [{ name: "a", direction: "input", width: 1, src: [] }],
      nodes: [{ id: "cloud:1", kind: "cloud", width: 1, pins: [], label: "x = a", src: [] }],
      nets: [],
    };
    const doc: SchematicDoc = { version: 1, fidelity: "structural", top: "m", modules: { m: view }, moduleNames: ["m"], diagnostics: [], sourceUri: "t", generation: 1 };
    expect(() => docToVerilog(doc)).toThrow(ExportError);
  });

  it("masks x and z bits but counts a real difference", () => {
    const r = compareOutputs(["1x0 1"], ["110 0"], ["a", "b"]);
    expect(r.masked).toBe(1);
    expect(r.mismatches).toBe(1);
    expect(r.first?.output).toBe("b");
    expect(compareOutputs(["10"], ["10"], ["a"]).mismatches).toBe(0);
    expect(compareOutputs(["10", "11"], ["10"], ["a"]).mismatches).toBe(1);
  });

  it("finds the clock through the flip-flop CLK pin and toggles it in the testbench", async () => {
    const { doc } = await synthDoc("counter4.v");
    const view = doc.modules["top_module"]!;
    expect(clockInputs(view)).toEqual(["clk"]);
    const tb = buildTestbench({ top: "top_module", view, clocks: ["clk"], vectors: 3, seed: 1 });
    expect(tb.text).toContain("clk = 1;");
    expect((tb.text.match(/\$display/g) ?? []).length).toBe(6);
    disposeTestBackend();
  });
});

describe("L3 harness", () => {
  const box = (id: string, x: number, y: number, w: number, h: number) => ({ id, x, y, width: w, height: h, ports: [] });

  it("recovers text boxes through nested translates", () => {
    const inner = `<g class="node" data-id="n1" transform="translate(10,20)"><text class="label" x="5" y="7" text-anchor="start">ab</text></g>`;
    const t = textBoxes(inner);
    expect(t).toHaveLength(1);
    expect(t[0]!.owner).toBe("n1");
    expect(Math.round(t[0]!.x)).toBe(15);
    expect(t[0]!.w).toBeCloseTo(2 * 11 * 0.6);
  });

  it("flags a label wider than its symbol and two overlapping labels", () => {
    const view: ModuleView = {
      name: "m",
      ports: [],
      nodes: [
        { id: "c1", kind: "const", width: 8, pins: [{ id: "Y", label: "", direction: "out", side: "east", width: 8, net: null }], label: "8'hffffffffffff", src: [] },
      ],
      nets: [],
    };
    const layout: ElkGraphOut = { id: "root", width: 100, height: 60, children: [box("c1", 10, 10, 20, 18)], edges: [] };
    const rep = checkLayout(view, layout);
    expect(rep.labelsInside.ok).toBe(false);
    expect(rep.labelsInside.issues[0]).toMatch(/spills out of c1/);
    const two: ModuleView = {
      ...view,
      nodes: [
        { id: "a", kind: "const", width: 1, pins: [{ id: "Y", label: "", direction: "out", side: "east", width: 1, net: null }], label: "1'b1", src: [] },
        { id: "b", kind: "const", width: 1, pins: [{ id: "Y", label: "", direction: "out", side: "east", width: 1, net: null }], label: "1'b0", src: [] },
      ],
    };
    const stacked: ElkGraphOut = { id: "root", width: 100, height: 60, children: [box("a", 10, 10, 40, 18), box("b", 12, 12, 40, 18)], edges: [] };
    expect(checkLayout(two, stacked).noOverlap.ok).toBe(false);
  });

  it("flags a missing bus label and a wire through a symbol", () => {
    const view: ModuleView = {
      name: "m",
      ports: [
        { name: "a", direction: "input", width: 4, src: [] },
        { name: "y", direction: "output", width: 4, src: [] },
      ],
      nodes: [{ id: "k", kind: "const", width: 1, pins: [{ id: "Y", label: "", direction: "out", side: "east", width: 1, net: null }], label: "1'b0", src: [] }],
      nets: [{ id: "net:a", name: "a", width: 4, driver: { node: "port:a", pin: "a" }, sinks: [{ node: "port:y", pin: "y" }], src: [] }],
    };
    const layout: ElkGraphOut = {
      id: "root",
      width: 300,
      height: 100,
      children: [
        { ...box("port:a", 0, 40, 30, 20), ports: [{ id: "port:a.a", x: 30, y: 10, width: 1, height: 1, layoutOptions: {} }] },
        { ...box("port:y", 250, 40, 30, 20), ports: [{ id: "port:y.y", x: 0, y: 10, width: 1, height: 1, layoutOptions: {} }] },
        box("k", 120, 40, 40, 20),
      ],
      // No sections: nothing drawn, so no width label.
      edges: [{ id: "edge:net:a:0", sources: ["port:a.a"], targets: ["port:y.y"] }],
    };
    const rep = checkLayout(view, layout);
    expect(rep.busLabels.ok).toBe(false);
    const through: ElkGraphOut = { ...layout, edges: [{ ...layout.edges[0]!, sections: [{ id: "s", startPoint: { x: 30, y: 50 }, endPoint: { x: 250, y: 50 } }] }] };
    const rep2 = checkLayout(view, through);
    expect(rep2.busLabels.ok).toBe(true);
    expect(rep2.wiresClear.ok).toBe(false);
    expect(rep2.wiresClear.issues[0]).toMatch(/crosses k/);
  });

  it("flags parallel wires of different nets closer than 8 px", () => {
    const view: ModuleView = {
      name: "m",
      ports: [
        { name: "a", direction: "input", width: 1, src: [] },
        { name: "b", direction: "input", width: 1, src: [] },
        { name: "y", direction: "output", width: 1, src: [] },
        { name: "z", direction: "output", width: 1, src: [] },
      ],
      nodes: [],
      nets: [
        { id: "net:a", name: "a", width: 1, driver: { node: "port:a", pin: "a" }, sinks: [{ node: "port:y", pin: "y" }], src: [] },
        { id: "net:b", name: "b", width: 1, driver: { node: "port:b", pin: "b" }, sinks: [{ node: "port:z", pin: "z" }], src: [] },
      ],
    };
    const wires = (dy: number): ElkGraphOut => ({
      id: "root",
      width: 300,
      height: 120,
      children: [box("port:a", 0, 20, 30, 20), box("port:b", 0, 60, 30, 20), box("port:y", 250, 20, 30, 20), box("port:z", 250, 60, 30, 20)],
      edges: [
        { id: "edge:net:a:0", sources: ["port:a.a"], targets: ["port:y.y"], sections: [{ id: "s1", startPoint: { x: 30, y: 30 }, endPoint: { x: 250, y: 30 } }] },
        { id: "edge:net:b:0", sources: ["port:b.b"], targets: ["port:z.z"], sections: [{ id: "s2", startPoint: { x: 30, y: 70 }, bendPoints: [{ x: 100, y: 70 }, { x: 100, y: 30 + dy }, { x: 200, y: 30 + dy }, { x: 200, y: 70 }], endPoint: { x: 250, y: 70 } }] },
      ],
    });
    expect(checkLayout(view, wires(4)).wireSpacing.ok).toBe(false);
    expect(checkLayout(view, wires(4)).wireSpacing.issues[0]).toMatch(/net:a and net:b run 4 px apart/);
    expect(checkLayout(view, wires(8)).wireSpacing.ok).toBe(true);
  });

  it("flags a width label that cannot get clear of another net's wire", () => {
    const view: ModuleView = {
      name: "m",
      ports: [
        { name: "a", direction: "input", width: 4, src: [] },
        { name: "y", direction: "output", width: 4, src: [] },
        { name: "c", direction: "input", width: 1, src: [] },
        { name: "z", direction: "output", width: 1, src: [] },
      ],
      nodes: [],
      nets: [
        { id: "net:a", name: "a", width: 4, driver: { node: "port:a", pin: "a" }, sinks: [{ node: "port:y", pin: "y" }], src: [] },
        { id: "net:c", name: "c", width: 1, driver: { node: "port:c", pin: "c" }, sinks: [{ node: "port:z", pin: "z" }], src: [] },
      ],
    };
    // The bus is 20 px long, so the only label spot is its middle, where c's vertical wire passes.
    const layout: ElkGraphOut = {
      id: "root",
      width: 200,
      height: 200,
      children: [box("port:a", 0, 90, 30, 20), box("port:y", 50, 90, 30, 20), box("port:c", 0, 0, 30, 20), box("port:z", 150, 160, 30, 20)],
      edges: [
        { id: "edge:net:a:0", sources: ["port:a.a"], targets: ["port:y.y"], sections: [{ id: "s1", startPoint: { x: 30, y: 100 }, endPoint: { x: 50, y: 100 } }] },
        { id: "edge:net:c:0", sources: ["port:c.c"], targets: ["port:z.z"], sections: [{ id: "s2", startPoint: { x: 30, y: 10 }, bendPoints: [{ x: 45, y: 10 }, { x: 45, y: 170 }], endPoint: { x: 150, y: 170 } }] },
      ],
    };
    const rep = checkLayout(view, layout);
    expect(rep.labelsClear.ok).toBe(false);
    expect(rep.labelsClear.issues[0]).toMatch(/"4" \(bus-width\) sits on a wire of net:c/);
  });

  it("flags a 4-way junction that cannot be separated and accepts a T", () => {
    const ports = ["a", "y", "n", "s"].map((name, i) => ({ name, direction: i === 0 ? ("input" as const) : ("output" as const), width: 1, src: [] }));
    const view: ModuleView = {
      name: "m",
      ports,
      nodes: [],
      nets: [{ id: "net:a", name: "a", width: 1, driver: { node: "port:a", pin: "a" }, sinks: [{ node: "port:y", pin: "y" }, { node: "port:n", pin: "n" }, { node: "port:s", pin: "s" }], src: [] }],
    };
    // Both branch legs end directly on a pin, so neither can slide: the cross stays and is reported.
    const cross: ElkGraphOut = {
      id: "root",
      width: 300,
      height: 300,
      children: [box("port:a", 0, 140, 30, 20), box("port:y", 250, 140, 30, 20), box("port:n", 135, 0, 30, 20), box("port:s", 135, 280, 30, 20)],
      edges: [
        { id: "edge:net:a:0", sources: ["port:a.a"], targets: ["port:y.y"], sections: [{ id: "s1", startPoint: { x: 30, y: 150 }, endPoint: { x: 250, y: 150 } }], junctionPoints: [{ x: 150, y: 150 }] },
        { id: "edge:net:a:1", sources: ["port:a.a"], targets: ["port:n.n"], sections: [{ id: "s2", startPoint: { x: 30, y: 150 }, bendPoints: [{ x: 150, y: 150 }], endPoint: { x: 150, y: 20 } }] },
        { id: "edge:net:a:2", sources: ["port:a.a"], targets: ["port:s.s"], sections: [{ id: "s3", startPoint: { x: 30, y: 150 }, bendPoints: [{ x: 150, y: 150 }], endPoint: { x: 150, y: 280 } }] },
      ],
    };
    const rep = checkLayout(view, cross);
    expect(rep.junctions.ok).toBe(false);
    expect(rep.junctions.issues[0]).toMatch(/4-way junction of net:a at 150,150/);
    const tee: ElkGraphOut = { ...cross, edges: cross.edges.slice(0, 2) };
    expect(checkLayout(view, tee).junctions.ok).toBe(true);
    expect(junctionDots(checkLayout(view, tee).svg)).toEqual([{ net: "net:a", x: 150, y: 150, r: Number(fmt(junctionRadius(1))) }]);
  });

  it("finds the junction dots of a bus net whose group holds nested groups", () => {
    const ports = ["a", "y", "n"].map((name, i) => ({ name, direction: i === 0 ? ("input" as const) : ("output" as const), width: 4, src: [] }));
    const view: ModuleView = {
      name: "m",
      ports,
      nodes: [],
      nets: [{ id: "net:a", name: "a", width: 4, driver: { node: "port:a", pin: "a" }, sinks: [{ node: "port:y", pin: "y" }, { node: "port:n", pin: "n" }], src: [] }],
    };
    const tee: ElkGraphOut = {
      id: "root",
      width: 300,
      height: 300,
      children: [box("port:a", 0, 140, 30, 20), box("port:y", 250, 140, 30, 20), box("port:n", 135, 0, 30, 20)],
      edges: [
        { id: "edge:net:a:0", sources: ["port:a.a"], targets: ["port:y.y"], sections: [{ id: "s1", startPoint: { x: 30, y: 150 }, endPoint: { x: 250, y: 150 } }], junctionPoints: [{ x: 150, y: 150 }] },
        { id: "edge:net:a:1", sources: ["port:a.a"], targets: ["port:n.n"], sections: [{ id: "s2", startPoint: { x: 30, y: 150 }, bendPoints: [{ x: 150, y: 150 }], endPoint: { x: 150, y: 20 } }] },
      ],
    };
    const rep = checkLayout(view, tee);
    // The bus slash and width label sit in a nested group before the dot; the dot must still be found.
    expect(rep.svg).toMatch(/<g class="bus-mark">/);
    expect(junctionDots(rep.svg)).toEqual([{ net: "net:a", x: 150, y: 150, r: Number(fmt(junctionRadius(8))) }]);
    expect(rep.junctions.ok).toBe(true);
  });

  it("flags junction dots closer than 20 px and a plain crossing closer than 16 px to a dot", () => {
    const ports = ["a", "y", "n", "s", "c", "z"].map((name, i) => ({ name, direction: i === 0 || i === 4 ? ("input" as const) : ("output" as const), width: 1, src: [] }));
    const view: ModuleView = {
      name: "m",
      ports,
      nodes: [],
      nets: [
        { id: "net:a", name: "a", width: 1, driver: { node: "port:a", pin: "a" }, sinks: [{ node: "port:y", pin: "y" }, { node: "port:n", pin: "n" }, { node: "port:s", pin: "s" }], src: [] },
        { id: "net:c", name: "c", width: 1, driver: { node: "port:c", pin: "c" }, sinks: [{ node: "port:z", pin: "z" }], src: [] },
      ],
    };
    // Two T junctions of net a at x=150 (up) and x=150+dDot (down); net c runs vertically at x=150+dCross.
    // Every branch leg ends on a pin, so nothing can slide: the checker sees the geometry as given.
    const graph = (dDot: number, dCross: number): ElkGraphOut => ({
      id: "root",
      width: 400,
      height: 300,
      children: [box("port:a", 0, 140, 30, 20), box("port:y", 350, 140, 30, 20), box("port:n", 135, 0, 30, 20), box("port:s", 135 + dDot, 280, 30, 20), box("port:c", 140 + dCross, 0, 20, 10), box("port:z", 140 + dCross, 290, 20, 10)],
      edges: [
        { id: "edge:net:a:0", sources: ["port:a.a"], targets: ["port:y.y"], sections: [{ id: "s1", startPoint: { x: 30, y: 150 }, endPoint: { x: 350, y: 150 } }], junctionPoints: [{ x: 150, y: 150 }, { x: 150 + dDot, y: 150 }] },
        { id: "edge:net:a:1", sources: ["port:a.a"], targets: ["port:n.n"], sections: [{ id: "s2", startPoint: { x: 30, y: 150 }, bendPoints: [{ x: 150, y: 150 }], endPoint: { x: 150, y: 20 } }] },
        { id: "edge:net:a:2", sources: ["port:a.a"], targets: ["port:s.s"], sections: [{ id: "s3", startPoint: { x: 30, y: 150 }, bendPoints: [{ x: 150 + dDot, y: 150 }], endPoint: { x: 150 + dDot, y: 280 } }] },
        { id: "edge:net:c:0", sources: ["port:c.c"], targets: ["port:z.z"], sections: [{ id: "s4", startPoint: { x: 150 + dCross, y: 10 }, endPoint: { x: 150 + dCross, y: 290 } }] },
      ],
    });
    const crowded = checkLayout(view, graph(12, 60));
    expect(crowded.junctionSpacing.ok).toBe(false);
    expect(crowded.junctionSpacing.issues[0]).toMatch(/junction dots of net:a at 150,150 and net:a at 162,150 are 12 px apart/);
    expect(crowded.crossingClearance.ok).toBe(true);
    const nearCross = checkLayout(view, graph(60, 10));
    expect(nearCross.junctionSpacing.ok).toBe(true);
    expect(nearCross.crossingClearance.ok).toBe(false);
    expect(nearCross.crossingClearance.issues[0]).toMatch(/crossing of net:a and net:c at 160,150 is 10 px from the junction dot of net:a at 150,150/);
    const clear = checkLayout(view, graph(20, 36));
    expect(clear.junctionSpacing.ok).toBe(true);
    expect(clear.crossingClearance.ok).toBe(true);
    expect(junctionDots(clear.svg)).toHaveLength(2);
  });

  it("junction dots are 2.5 times the stroke width the stylesheet draws", () => {
    const css = readFileSync(join(ROOT, "webview", "styles.css"), "utf8");
    // The stylesheet names a token; its value sits on :root.
    const token = (rule: RegExp): number => {
      const name = new RegExp(`${rule.source}[^}]*stroke-width: var\\((--rl-stroke-[a-z]+)\\)`).exec(css)?.[1];
      const value = new RegExp(`${name}: ([\\d.]+)px;`).exec(css)?.[1];
      return Number(value);
    };
    expect(token(/\.schematic \.net-path \{/)).toBe(WIRE_STROKE.single);
    expect(token(/\.schematic \.net\.bus \.net-path \{/)).toBe(WIRE_STROKE.bus);
    expect(junctionRadius(1)).toBe(2.5 * WIRE_STROKE.single);
    expect(junctionRadius(8)).toBe(2.5 * WIRE_STROKE.bus);
  });

  it("fit check follows the cap constant", async () => {
    const { doc } = await synthDoc("notgate.v");
    const view = doc.modules["top_module"]!;
    const rep = checkLayout(view, await layoutView(view));
    expect(rep.fit.ok).toBe(FIT_MAX_SCALE <= 1 || rep.fitScale <= 1);
    disposeTestBackend();
  });
});
