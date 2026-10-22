// Thin wrapper around acquireVsCodeApi so tests can stub it on window.
import type { WebviewToHost } from "../src/shared/protocol";

export interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
    /** Set by the inline boot script in webviewHtml.ts, which calls acquireVsCodeApi() first */
    __rtlLiveVsCodeApi?: VsCodeApi;
    __rtlLiveTestHooks?: Record<string, unknown>;
  }
}

let api: VsCodeApi | undefined;

export function vscodeApi(): VsCodeApi {
  if (api) return api;
  if (window.__rtlLiveVsCodeApi) {
    api = window.__rtlLiveVsCodeApi;
  } else if (typeof window.acquireVsCodeApi === "function") {
    api = window.acquireVsCodeApi();
  } else {
    // Standalone (Playwright) fallback: messages go to a window-level array.
    const posted: unknown[] = [];
    let state: unknown = undefined;
    api = {
      postMessage: (m) => posted.push(m),
      getState: () => state,
      setState: (s) => {
        state = s;
      },
    };
    window.__rtlLiveTestHooks = { ...(window.__rtlLiveTestHooks ?? {}), posted };
  }
  return api;
}

export function postToHost(msg: WebviewToHost): void {
  vscodeApi().postMessage(msg);
}
