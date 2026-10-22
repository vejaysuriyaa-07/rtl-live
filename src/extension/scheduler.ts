// Per-document scheduling of structural and synthesis runs.
// - generation counter per document; stale results are dropped by the caller
// - separate debounce for structural (fast) and synthesis (slow)
// - at most one synthesis in flight plus one pending; latest wins
// Timer functions are injectable so unit tests can use fake timers.
export interface SchedulerTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SchedulerOptions {
  structuralDebounceMs: number;
  synthDebounceMs: number;
  timers?: SchedulerTimers;
}

export interface StructuralJob {
  docKey: string;
  generation: number;
  text: string;
}

export interface SynthJob extends StructuralJob {
  /** Cancels the in-flight run when a newer one supersedes it */
  signal: AbortSignal;
}

export interface SchedulerCallbacks {
  runStructural(job: StructuralJob): void;
  /** Return a promise that settles when synthesis is done; never reject into the scheduler. */
  runSynth(job: SynthJob): Promise<void>;
}

interface DocState {
  generation: number;
  text: string;
  structuralTimer: unknown;
  synthTimer: unknown;
  inFlight: { generation: number; controller: AbortController } | undefined;
  pending: { generation: number; text: string } | undefined;
}

export class Scheduler {
  private readonly docs = new Map<string, DocState>();
  private readonly timers: SchedulerTimers;
  private options: SchedulerOptions;
  /** Counters for tests and the log */
  stats = { structuralRuns: 0, synthRuns: 0, synthCancelled: 0, synthSkipped: 0 };

  constructor(options: SchedulerOptions, private readonly callbacks: SchedulerCallbacks) {
    this.options = options;
    this.timers = options.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) };
  }

  updateOptions(options: Partial<SchedulerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  private state(docKey: string): DocState {
    let s = this.docs.get(docKey);
    if (!s) {
      s = { generation: 0, text: "", structuralTimer: undefined, synthTimer: undefined, inFlight: undefined, pending: undefined };
      this.docs.set(docKey, s);
    }
    return s;
  }

  currentGeneration(docKey: string): number {
    return this.docs.get(docKey)?.generation ?? 0;
  }

  /** Called on every text change. Returns the new generation. */
  textChanged(docKey: string, text: string, opts?: { synth?: boolean; immediate?: boolean }): number {
    const s = this.state(docKey);
    s.generation++;
    s.text = text;
    const gen = s.generation;
    this.timers.clearTimeout(s.structuralTimer);
    const runStructural = (): void => {
      s.structuralTimer = undefined;
      if (s.generation !== gen) return;
      this.stats.structuralRuns++;
      this.callbacks.runStructural({ docKey, generation: gen, text });
    };
    if (opts?.immediate) runStructural();
    else s.structuralTimer = this.timers.setTimeout(runStructural, this.options.structuralDebounceMs);

    if (opts?.synth !== false) this.scheduleSynth(docKey, gen, text);
    return gen;
  }

  /** Request synthesis for the current generation (used after the structural layer reports a clean tree). */
  requestSynth(docKey: string, generation: number, text: string): void {
    const s = this.state(docKey);
    if (s.generation !== generation) return;
    this.scheduleSynth(docKey, generation, text);
  }

  private scheduleSynth(docKey: string, gen: number, text: string): void {
    const s = this.state(docKey);
    this.timers.clearTimeout(s.synthTimer);
    s.synthTimer = this.timers.setTimeout(() => {
      s.synthTimer = undefined;
      if (s.generation !== gen) return;
      this.startOrQueueSynth(docKey, gen, text);
    }, this.options.synthDebounceMs);
  }

  private startOrQueueSynth(docKey: string, gen: number, text: string): void {
    const s = this.state(docKey);
    if (s.inFlight) {
      // Supersede: cancel the running job and keep only the newest pending one.
      s.inFlight.controller.abort();
      this.stats.synthCancelled++;
      if (s.pending) this.stats.synthSkipped++;
      s.pending = { generation: gen, text };
      return;
    }
    this.launch(docKey, gen, text);
  }

  private launch(docKey: string, gen: number, text: string): void {
    const s = this.state(docKey);
    const controller = new AbortController();
    s.inFlight = { generation: gen, controller };
    this.stats.synthRuns++;
    const done = (): void => {
      if (s.inFlight?.controller === controller) s.inFlight = undefined;
      const p = s.pending;
      if (p && !s.inFlight) {
        s.pending = undefined;
        if (s.generation === p.generation) this.launch(docKey, p.generation, p.text);
      }
    };
    let promise: Promise<void>;
    try {
      promise = this.callbacks.runSynth({ docKey, generation: gen, text, signal: controller.signal });
    } catch {
      promise = Promise.resolve();
    }
    promise.then(done, done);
  }

  cancelAll(docKey?: string): void {
    for (const [key, s] of this.docs) {
      if (docKey !== undefined && key !== docKey) continue;
      this.timers.clearTimeout(s.structuralTimer);
      this.timers.clearTimeout(s.synthTimer);
      s.inFlight?.controller.abort();
      s.pending = undefined;
    }
  }

  dispose(): void {
    this.cancelAll();
    this.docs.clear();
  }
}
