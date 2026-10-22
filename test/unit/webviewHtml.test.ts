import { describe, expect, it } from "vitest";
import { BOOT_SCRIPT, buildCsp, buildFallbackHtml, buildWebviewHtml, makeNonce } from "../../src/extension/webviewHtml";

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

  it("runs the boot script before the bundle and the bundle last", () => {
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(2);
    expect(html.indexOf(BOOT_SCRIPT)).toBeLessThan(html.indexOf("dist/webview.js"));
    expect(html).toContain(`<script nonce="${nonce}">${BOOT_SCRIPT}</script>`);
  });

  it("boot script reports load failures and errors through postMessage only", () => {
    expect(BOOT_SCRIPT).toContain('type: "log"');
    expect(BOOT_SCRIPT).toContain("failed to load");
    expect(BOOT_SCRIPT).toContain("unhandledrejection");
    expect(BOOT_SCRIPT).not.toMatch(/https?:/);
    expect(BOOT_SCRIPT).not.toContain("eval(");
  });

  it("generates 32-char alphanumeric nonces", () => {
    const n = makeNonce();
    expect(n).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(makeNonce()).not.toBe(n);
  });

  it("fallback page keeps the CSP, nonces its script and offers Reload Window twice", () => {
    const fb = buildFallbackHtml({ cspSource, nonce, reason: "never <ready>" });
    expect(fb).toContain(`<meta http-equiv="Content-Security-Policy" content="${buildCsp(cspSource, nonce)}">`);
    for (const tag of fb.match(/<script[^>]*>/g) ?? []) expect(tag).toContain(`nonce="${nonce}"`);
    expect(fb).toContain('href="command:workbench.action.reloadWindow"');
    expect(fb).toContain('type: "reloadWindow"');
    expect(fb).toContain("never &lt;ready>");
    expect(fb).not.toMatch(/https?:/);
  });
});
