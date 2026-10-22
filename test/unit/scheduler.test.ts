import { describe, expect, it, vi } from "vitest";
import { Scheduler, type SynthJob } from "../../src/extension/scheduler";
import { LruCache, sha256 } from "../../src/extension/cache";

function makeScheduler(opts?: { synthDelay?: number }) {
  const structural: number[] = [];
  const synth: { gen: number; aborted: boolean }[] = [];
  const s = new Scheduler(
    { structuralDebounceMs: 60, synthDebounceMs: 300 },
    {
      runStructural: (job) => structural.push(job.generation),
      runSynth: (job: SynthJob) =>
        new Promise<void>((resolve) => {
          const entry = { gen: job.generation, aborted: false };
          synth.push(entry);
          job.signal.addEventListener("abort", () => {
            entry.aborted = true;
            resolve();
          });
          setTimeout(resolve, opts?.synthDelay ?? 50);
        }),
    },
  );
  return { s, structural, synth };
}

describe("scheduler", () => {
  it("debounces structural runs and drops stale generations", () => {
    vi.useFakeTimers();
    const { s, structural } = makeScheduler();
    for (let i = 0; i < 20; i++) {
      s.textChanged("doc", `text ${i}`);
      vi.advanceTimersByTime(10);
    }
    expect(structural).toEqual([]);
    vi.advanceTimersByTime(60);
    expect(structural).toEqual([20]);
    vi.useRealTimers();
  });

  it("runs at most one synthesis in flight plus one pending, latest wins", async () => {
    vi.useFakeTimers();
    const { s, synth } = makeScheduler({ synthDelay: 1000 });
    s.textChanged("doc", "a");
    vi.advanceTimersByTime(300);
    expect(synth.map((x) => x.gen)).toEqual([1]);
    s.textChanged("doc", "b");
    vi.advanceTimersByTime(300);
    // gen 1 aborted, gen 2 pending
    expect(synth[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.map((x) => x.gen)).toEqual([1, 2]);
    s.textChanged("doc", "c");
    s.textChanged("doc", "d");
    vi.advanceTimersByTime(300);
    await vi.advanceTimersByTimeAsync(0);
    // gen 2 aborted; gen 4 launched (gen 3 never scheduled because debounce collapsed it)
    expect(synth.map((x) => x.gen)).toEqual([1, 2, 4]);
    expect(s.stats.synthCancelled).toBe(2);
    vi.useRealTimers();
  });

  it("20 edits 10 ms apart post only the last generation", async () => {
    vi.useFakeTimers();
    const { s, structural, synth } = makeScheduler({ synthDelay: 20 });
    for (let i = 0; i < 20; i++) {
      s.textChanged("doc", `v${i}`);
      vi.advanceTimersByTime(10);
    }
    await vi.advanceTimersByTimeAsync(400);
    expect(structural).toEqual([20]);
    expect(synth.map((x) => x.gen)).toEqual([20]);
    vi.useRealTimers();
  });
});

describe("lru cache", () => {
  it("evicts the least recently used entry", () => {
    const c = new LruCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });
  it("hashes parts separately", () => {
    expect(sha256("ab", "c")).not.toBe(sha256("a", "bc"));
  });
});
