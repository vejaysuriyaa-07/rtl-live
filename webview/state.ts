import type { SchematicDoc } from "../src/ir/types";
import type { StatusInfo, BannerError, ThemeKind } from "../src/shared/protocol";

export interface ViewState {
  doc: SchematicDoc | undefined;
  /** Last synthesized doc kept while newer structural docs arrive with errors */
  lastGood: SchematicDoc | undefined;
  generation: number;
  /** Drill-down stack of module names; last is the one displayed */
  stack: string[];
  status: StatusInfo;
  error: BannerError | null;
  theme: ThemeKind;
  fitted: boolean;
}

export function initialState(): ViewState {
  return {
    doc: undefined,
    lastGood: undefined,
    generation: -1,
    stack: [],
    status: { fidelity: "structural", backend: "none" },
    error: null,
    theme: "dark",
    fitted: false,
  };
}

export function currentModuleName(s: ViewState): string | undefined {
  const top = s.stack[s.stack.length - 1];
  if (top) return top;
  return s.doc?.top || undefined;
}
