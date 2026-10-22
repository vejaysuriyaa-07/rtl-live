import * as assert from "node:assert";
import * as vscode from "vscode";
import { getApi, openFixture } from "./util";

suite("M2 synthesis", () => {
  test("7458.v synthesizes to 4 ANDs and 2 ORs", async function () {
    this.timeout(120_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await api.whenReady();
    await api.controller.whenParserReady();
    const { doc } = await openFixture("7458.v");
    const ev = await api.nextRender((e) => e.doc.sourceUri === doc.uri.toString() && e.doc.fidelity === "synthesized", 90_000);
    const top = ev.doc.modules["top_module"]!;
    const ands = top.nodes.filter((n) => n.kind === "gate" && n.op === "and");
    const ors = top.nodes.filter((n) => n.kind === "gate" && n.op === "or");
    assert.strictEqual(ands.length, 4);
    assert.strictEqual(ors.length, 2);
    assert.strictEqual(api.controller.currentStatus.fidelity, "synthesized");
    console.log(`backend: ${api.controller.currentStatus.backend} ${api.controller.currentStatus.backendVersion ?? ""}`);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });

  test("20 edits 10 ms apart synthesize only the last generation with no unhandled rejection", async function () {
    this.timeout(120_000);
    const api = await getApi();
    const rejections: unknown[] = [];
    const onRej = (r: unknown): void => {
      rejections.push(r);
    };
    process.on("unhandledRejection", onRej);
    try {
      const { doc, editor } = await openFixture("notgate.v");
      await api.nextRender((e) => e.doc.sourceUri === doc.uri.toString() && e.doc.fidelity === "synthesized", 90_000);
      const runsBefore = api.controller.stats.synthRuns;
      const resultsBefore = api.controller.stats.synthResults;
      for (let i = 0; i < 20; i++) {
        await editor.edit((b) => b.insert(new vscode.Position(doc.lineCount, 0), `// e${i}\n`));
        await new Promise((r) => setTimeout(r, 10));
      }
      const final = await api.nextRender((e) => e.doc.sourceUri === doc.uri.toString() && e.doc.fidelity === "synthesized", 90_000);
      // Let any straggling runs settle.
      await new Promise((r) => setTimeout(r, 800));
      const runs = api.controller.stats.synthRuns - runsBefore;
      const results = api.controller.stats.synthResults - resultsBefore;
      console.log(`synth runs after 20 edits: ${runs}, results posted: ${results}, final generation ${final.generation}`);
      assert.ok(runs <= 2, `expected at most 2 synthesis runs, got ${runs}`);
      assert.strictEqual(results, 1, "only the last generation should post a synthesized render");
      assert.strictEqual(api.controller.lastRenderEvent?.generation, final.generation);
      assert.deepStrictEqual(rejections, []);
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    } finally {
      process.off("unhandledRejection", onRej);
    }
  });
});
