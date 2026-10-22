import { describe, expect, it, vi } from "vitest";
import { WebviewLifecycle, type LifecycleHooks } from "../../src/extension/lifecycle";

function make(opts?: { visible?: boolean }) {
  const calls = { reload: [] as string[], fallback: 0, pings: [] as number[], log: [] as string[] };
  let visible = opts?.visible ?? true;
  const hooks: LifecycleHooks = {
    reload: (r) => {
      calls.reload.push(r);
      lc.htmlSet();
    },
    showFallback: () => calls.fallback++,
    ping: (id) => calls.pings.push(id),
    isVisible: () => visible,
    log: (l, t) => calls.log.push(`${l}: ${t}`),
  };
  const lc = new WebviewLifecycle({ readyTimeoutMs: 1000, heartbeatMs: 5000, pongTimeoutMs: 500 }, hooks);
  return { lc, calls, setVisible: (v: boolean) => (visible = v) };
}

describe("webview lifecycle", () => {
  it("reloads once when ready never arrives, then shows the fallback page", () => {
    vi.useFakeTimers();
    const { lc, calls } = make();
    lc.htmlSet();
    vi.advanceTimersByTime(999);
    expect(calls.reload).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls.reload).toEqual(["no ready"]);
    expect(lc.state).toBe("loading");
    vi.advanceTimersByTime(1000);
    expect(calls.fallback).toBe(1);
    expect(lc.state).toBe("failed");
    expect(lc.stats).toMatchObject({ readyTimeouts: 2, reloads: 1, fallbacks: 1 });
    vi.useRealTimers();
  });

  it("a ready in time cancels the watchdog and starts the heartbeat", () => {
    vi.useFakeTimers();
    const { lc, calls } = make();
    lc.htmlSet();
    vi.advanceTimersByTime(500);
    lc.ready();
    vi.advanceTimersByTime(4999);
    expect(calls.reload).toEqual([]);
    expect(calls.pings).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls.pings).toEqual([1]);
    lc.pong(1);
    vi.advanceTimersByTime(5000);
    expect(calls.pings).toEqual([1, 2]);
    expect(lc.stats.pongs).toBe(1);
    expect(calls.reload).toEqual([]);
    vi.useRealTimers();
  });

  it("reloads the page when a ping goes unanswered and recovers on the next ready", () => {
    vi.useFakeTimers();
    const { lc, calls } = make();
    lc.htmlSet();
    lc.ready();
    vi.advanceTimersByTime(5000);
    expect(calls.pings).toEqual([1]);
    lc.pong(99); // wrong id is ignored
    vi.advanceTimersByTime(500);
    expect(calls.reload).toEqual(["no pong"]);
    expect(lc.stats.heartbeatMisses).toBe(1);
    expect(lc.state).toBe("loading");
    lc.ready();
    expect(lc.state).toBe("ready");
    vi.advanceTimersByTime(5000);
    expect(calls.pings).toEqual([1, 2]);
    vi.useRealTimers();
  });

  it("does not ping while hidden and pings at once on resync", () => {
    vi.useFakeTimers();
    const { lc, calls, setVisible } = make({ visible: false });
    lc.htmlSet();
    lc.ready();
    vi.advanceTimersByTime(20_000);
    expect(calls.pings).toEqual([]);
    setVisible(true);
    lc.resync("visible");
    expect(calls.pings).toEqual([1]);
    expect(lc.stats.resyncs).toBe(1);
    // A second resync while a ping is pending does nothing.
    lc.resync("focus");
    expect(calls.pings).toEqual([1]);
    lc.pong(1);
    vi.useRealTimers();
  });

  it("ignores everything after dispose", () => {
    vi.useFakeTimers();
    const { lc, calls } = make();
    lc.htmlSet();
    lc.dispose();
    vi.advanceTimersByTime(10_000);
    expect(calls.reload).toEqual([]);
    expect(calls.fallback).toBe(0);
    vi.useRealTimers();
  });
});
