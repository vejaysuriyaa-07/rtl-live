// The accuracy checks must be able to fail: each detector is fed a known-bad
// input here, so a green report means the design is right, not the checker blind.
import { describe, expect, it } from "vitest";
import type { ModuleView, SchematicDoc } from "../../src/ir/types";
import { docToVerilog, ExportError } from "../../src/ir/toVerilog";
import type { ElkGraphOut } from "../../webview/layout/types";
import { FIT_MAX_SCALE } from "../../webview/render/geometry";
import { HDLBITS, makeTreeSitterParser, readFixture } from "../unit/helpers";
import { disposeTestBackend, synthFixture } from "../unit/synthHelpers";
import { buildTestbench, checkEquivalence, clockInputs, compareOutputs, icarusAvailable } from "./equivalence";
import { checkLayout, layoutView, textBoxes } from "./layout";

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

  it("fit check follows the cap constant", async () => {
    const { doc } = await synthDoc("notgate.v");
    const view = doc.modules["top_module"]!;
    const rep = checkLayout(view, await layoutView(view));
    expect(rep.fit.ok).toBe(FIT_MAX_SCALE <= 1 || rep.fitScale <= 1);
    disposeTestBackend();
  });
});
