import * as assert from "node:assert";
import * as vscode from "vscode";
import { getApi, openFixture, withTimeout } from "./util";

function waitFor(what: string, ms: number, probe: () => boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const tick = (): void => {
      if (probe()) {
        resolve();
        return;
      }
      if (Date.now() - t0 > ms) {
        reject(new Error(`timeout waiting for ${what}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

suite("M7 lifecycle", () => {
  test("heartbeat pings are answered while the view is visible", async function () {
    this.timeout(60_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    api.provider.lifecycleOptions = { readyTimeoutMs: 3000, heartbeatMs: 250, pongTimeoutMs: 2000 };
    api.provider.reloadSidebar();
    await waitFor("ready after reload", 10_000, () => api.provider.isAnyReady);
    await waitFor("two answered pings", 10_000, () => (api.provider.lifecycleStats?.pongs ?? 0) >= 2);
    const stats = api.provider.lifecycleStats!;
    assert.strictEqual(stats.heartbeatMisses, 0, "a ping went unanswered");
    assert.strictEqual(stats.fallbacks, 0);
  });

  test("a page that never posts ready is reloaded once, then replaced by the failure page", async function () {
    this.timeout(60_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    api.provider.lifecycleOptions = { readyTimeoutMs: 400, heartbeatMs: 60_000, pongTimeoutMs: 2000 };
    // Only the first load is broken: the retry loads healthy HTML and becomes ready.
    api.provider.breakHtmlLoads = 1;
    api.provider.reloadSidebar();
    await waitFor("ready after the retry", 10_000, () => (api.provider.lifecycleStats?.readyTimeouts ?? 0) === 1 && api.provider.isAnyReady);
    assert.strictEqual(api.provider.sidebarFallbackShown, false);
    // Both loads broken: the second timeout shows the failure page.
    api.provider.breakHtmlLoads = 2;
    api.provider.reloadSidebar();
    await waitFor("failure page", 10_000, () => api.provider.sidebarFallbackShown);
    assert.strictEqual(api.provider.lifecycleStats?.readyTimeouts, 2);
    assert.strictEqual(api.provider.lifecycleStats?.fallbacks, 1);
    assert.strictEqual(api.provider.isAnyReady, false);
    // Recovery: a normal reload brings the view back and the next render reaches it.
    api.provider.lifecycleOptions = { readyTimeoutMs: 8000, heartbeatMs: 15_000, pongTimeoutMs: 5000 };
    const before = api.provider.postedRenders;
    api.provider.reloadSidebar();
    await waitFor("ready after recovery", 10_000, () => api.provider.isAnyReady && !api.provider.sidebarFallbackShown);
    const { doc } = await openFixture("notgate.v");
    await api.nextRender((e) => e.doc.sourceUri === doc.uri.toString(), 10_000);
    assert.ok(api.provider.postedRenders > before, "no render reached the recovered view");
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });

  test("hiding and showing the view resyncs and the diagram follows the active editor", async function () {
    this.timeout(60_000);
    const api = await getApi();
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await withTimeout(api.whenReady(), 10_000, "webview ready");
    const { doc } = await openFixture("wire.v");
    await api.nextRender((e) => e.doc.sourceUri === doc.uri.toString(), 10_000);
    const resyncs = api.provider.lifecycleStats?.resyncs ?? 0;
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("workbench.view.extension.rtlLive");
    await waitFor("resync after show", 10_000, () => (api.provider.lifecycleStats?.resyncs ?? 0) > resyncs);
    await waitFor("render after show", 10_000, () => api.controller.lastRenderEvent?.doc.sourceUri === doc.uri.toString());
    assert.strictEqual(api.provider.lifecycleStats?.heartbeatMisses, 0);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });
});
