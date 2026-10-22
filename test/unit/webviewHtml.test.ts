import { describe, expect, it } from "vitest";
import { buildCsp, buildWebviewHtml, makeNonce } from "../../src/extension/webviewHtml";

describe("webview html", () => {
  const cspSource = "vscode-webview://abc123";
  const nonce = "N0nceN0nceN0nceN0nceN0nceN0nce12";
  const html = buildWebviewHtml({
    cspSource,
    nonce,
    scriptUri: `${cspSource}/dist/webview.js`,
    styleUri: `${cspSource}/dist/webview.css`,
    elkWorkerUri: `${cspSource}/dist/elkWorker.js`,
  });

  it("emits the exact CSP string", () => {
    expect(buildCsp(cspSource, nonce)).toBe(
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${cspSource} 'nonce-${nonce}'; img-src ${cspSource} data: blob:; font-src ${cspSource}; worker-src blob:; connect-src ${cspSource}`,
    );
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${buildCsp(cspSource, nonce)}">`);
  });

  it("puts a nonce on every script tag", () => {
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });

  it("contains no http or https URLs", () => {
    expect(html).not.toMatch(/https?:/);
  });

  it("generates 32-char alphanumeric nonces", () => {
    const n = makeNonce();
    expect(n).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(makeNonce()).not.toBe(n);
  });
});
