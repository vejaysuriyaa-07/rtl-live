// Serves dist/ plus a harness page over http so the real dist/webview.js runs
// under Playwright with a stubbed acquireVsCodeApi.
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import type { Page } from "@playwright/test";
import type { SchematicDoc } from "../../src/ir/types";
import type { HostToWebview } from "../../src/shared/protocol";

export const ROOT = resolve(__dirname, "..", "..");
export const DIST = join(ROOT, "dist");

const THEMES: Record<string, string> = {
  dark: `--vscode-editor-foreground:#d4d4d4;--vscode-editor-background:#1e1e1e;--vscode-charts-blue:#3794ff;--vscode-editorError-foreground:#f14c4c;--vscode-focusBorder:#007fd4;--vscode-descriptionForeground:#9d9d9d;--vscode-font-family:-apple-system,system-ui,sans-serif;--vscode-font-size:13px;--vscode-charts-yellow:#cca700;--vscode-charts-green:#89d185;`,
  light: `--vscode-editor-foreground:#000000;--vscode-editor-background:#ffffff;--vscode-charts-blue:#1a85ff;--vscode-editorError-foreground:#e51400;--vscode-focusBorder:#0090f1;--vscode-descriptionForeground:#717171;--vscode-font-family:-apple-system,system-ui,sans-serif;--vscode-font-size:13px;--vscode-charts-yellow:#bf8803;--vscode-charts-green:#388a34;`,
  hc: `--vscode-editor-foreground:#ffffff;--vscode-editor-background:#000000;--vscode-charts-blue:#3794ff;--vscode-editorError-foreground:#f48771;--vscode-focusBorder:#f38518;--vscode-descriptionForeground:#ffffff;--vscode-font-family:-apple-system,system-ui,sans-serif;--vscode-font-size:13px;--vscode-charts-yellow:#ffd700;--vscode-charts-green:#89d185;`,
};

function page(theme: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>:root{${THEMES[theme] ?? THEMES["dark"]}} html,body{height:100%;margin:0}</style>
<link rel="stylesheet" href="/webview.css">
</head>
<body data-elk-worker-uri="/elkWorker.js">
<div id="app">
  <div id="toolbar"></div>
  <div id="banner" hidden></div>
  <div id="breadcrumb" hidden></div>
  <div id="canvas"></div>
  <div id="status"></div>
  <div id="empty" class="empty">Open a Verilog file (.v or .sv) to see its schematic.</div>
</div>
<script src="/webview.js"></script>
</body></html>`;
}

const TYPES: Record<string, string> = { ".js": "application/javascript", ".css": "text/css", ".wasm": "application/wasm", ".html": "text/html" };

export async function startHarness(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page(url.searchParams.get("theme") ?? "dark"));
      return;
    }
    const file = join(DIST, url.pathname);
    if (!file.startsWith(DIST) || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, url: `http://127.0.0.1:${port}` };
}

interface PostTarget {
  postMessage(msg: unknown, origin: string): void;
}

export async function postRender(pg: Page, doc: SchematicDoc, generation = 1): Promise<void> {
  const msg: HostToWebview = { type: "render", generation, doc, fitOnRender: true };
  await pg.evaluate((m) => (globalThis as unknown as PostTarget).postMessage(m, "*"), msg);
  await pg.waitForSelector("svg.schematic g.nodes", { timeout: 15_000 });
}

export async function post(pg: Page, msg: HostToWebview): Promise<void> {
  await pg.evaluate((m) => (globalThis as unknown as PostTarget).postMessage(m, "*"), msg);
}

/** Test hooks exposed by the webview bundle on globalThis. */
export interface TestHooks {
  posted: unknown[];
  elk: { mode: string };
  state: { stack: string[] };
}

export function hooks(pg: Page): Promise<TestHooks> {
  return pg.evaluate(() => {
    const h = (globalThis as unknown as { __rtlLiveTestHooks: TestHooks }).__rtlLiveTestHooks;
    return { posted: h.posted, elk: { mode: h.elk.mode }, state: { stack: h.state.stack } };
  });
}
