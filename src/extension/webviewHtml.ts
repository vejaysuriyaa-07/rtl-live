// Pure HTML builder for the schematic webview. Kept free of the vscode module
// so the CSP and nonce handling can be unit tested.

export interface WebviewHtmlInput {
  cspSource: string;
  nonce: string;
  scriptUri: string;
  styleUri: string;
  /** URI of dist/elkWorker.js for the Blob-URL layout worker */
  elkWorkerUri?: string;
  /** Initial state the webview should use before any message arrives */
  initialState?: string;
}

export function buildCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `img-src ${cspSource} data: blob:`,
    `font-src ${cspSource}`,
    "worker-src blob:",
    `connect-src ${cspSource}`,
  ].join("; ");
}

export function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Inline bootstrap that runs before dist/webview.js. It owns the single
 * acquireVsCodeApi() call (webview/vscodeApi.ts picks it up from
 * window.__rtlLiveVsCodeApi) and reports script/style load failures, uncaught
 * errors and unhandled rejections to the host as "log" messages, so a blank
 * view explains itself in the RTL Live output channel.
 */
export const BOOT_SCRIPT = `(function () {
  var api = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
  window.__rtlLiveVsCodeApi = api;
  function report(level, text) {
    if (api) api.postMessage({ type: "log", generation: 0, level: level, text: text });
  }
  window.addEventListener("error", function (ev) {
    var t = ev.target;
    if (t && t !== window && (t.tagName === "SCRIPT" || t.tagName === "LINK")) {
      report("error", "failed to load " + (t.src || t.href));
      return;
    }
    report("error", "uncaught " + (ev.message || String(ev.error)) + " at " + ev.filename + ":" + ev.lineno);
  }, true);
  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev.reason;
    report("error", "unhandled rejection: " + (r && r.stack ? r.stack : String(r)));
  });
  report("info", "webview booting " + (api ? "(vscode api)" : "(no vscode api)"));
})();`;

export function buildWebviewHtml(input: WebviewHtmlInput): string {
  const csp = buildCsp(input.cspSource, input.nonce);
  const n = input.nonce;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RTL Live</title>
<script nonce="${n}">${BOOT_SCRIPT}</script>
<link rel="stylesheet" nonce="${n}" href="${escapeAttr(input.styleUri)}">
</head>
<body data-initial-state="${escapeAttr(input.initialState ?? "")}" data-elk-worker-uri="${escapeAttr(input.elkWorkerUri ?? "")}">
<div id="app">
  <div id="toolbar"></div>
  <div id="banner" hidden></div>
  <div id="breadcrumb" hidden></div>
  <div id="canvas"></div>
  <div id="status"></div>
  <div id="empty" class="empty">Open a Verilog file (.v or .sv) to see its schematic.</div>
</div>
<script nonce="${n}" src="${escapeAttr(input.scriptUri)}"></script>
</body>
</html>`;
}

/**
 * Page shown when the real view never posted ready (twice). Plain text plus a
 * Reload Window action that works both as a command link (no script needed)
 * and as a button that posts reloadWindow to the host.
 */
export function buildFallbackHtml(input: { cspSource: string; nonce: string; reason: string }): string {
  const csp = buildCsp(input.cspSource, input.nonce);
  const n = input.nonce;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RTL Live</title>
<style nonce="${n}">
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 12px; }
button { font: inherit; padding: 4px 10px; }
a { color: var(--vscode-textLink-foreground); }
</style>
</head>
<body data-fallback="1">
<p><strong>RTL Live could not start its view.</strong></p>
<p>${escapeAttr(input.reason)}</p>
<p><button id="reload">Reload Window</button> or use <a href="command:workbench.action.reloadWindow">Developer: Reload Window</a>. Run "RTL Live: Show Log" for details.</p>
<script nonce="${n}">
(function () {
  var api = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
  var b = document.getElementById("reload");
  if (b) b.addEventListener("click", function () { if (api) api.postMessage({ type: "reloadWindow", generation: 0 }); });
})();
</script>
</body>
</html>`;
}
