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
