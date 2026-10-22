# RTL Live: build notes

Running log of decisions, pinned versions, verification, and open issues.
Newest milestone section at the bottom.

## Environment (verified 2026-10-22)

- macOS 15.1, Apple Silicon (arm64)
- Node v23.1.0, npm 10.9.0, git 2.47.0
- Native yosys: not installed (brew). Wasm backend is the default path on this machine.
- verilator 5.052 at /opt/homebrew/bin/verilator
- iverilog at /opt/homebrew/bin/iverilog
- docker binary at /usr/local/bin/docker (Docker Desktop was not running at start; launched for the grammar build)
- emcc: not installed
- `code` CLI: not on PATH and no `/Applications/Visual Studio Code.app/Contents` found. Install step in the morning checklist must be run by VJ from a VS Code terminal or after "Shell Command: Install 'code' command in PATH".

## Pinned versions

| Package | Version | Role |
| --- | --- | --- |
| typescript | 5.9.3 | strict typecheck |
| esbuild | 0.28.2 | all bundles |
| web-tree-sitter | 0.27.1 | structural parser runtime |
| tree-sitter-cli | 0.27.1 | grammar wasm build (minor matches web-tree-sitter) |
| tree-sitter-verilog | 1.0.0 | grammar (spec said 1.0.3; npm's latest is 1.0.0, see M1) |
| @yowasp/yosys | 0.70.1258 | wasm synthesis backend |
| elkjs | 0.12.0 | layout |
| d3-selection / d3-zoom | 3.0.0 | pan and zoom |
| vitest | 5.0.5 | unit and golden tests |
| @vscode/test-cli / @vscode/test-electron | 0.0.15 / 3.1.0 | integration tests |
| mocha | 12.0.3 | integration test runner |
| @playwright/test | 1.64.1 | webview tests and screenshots |
| @vscode/vsce | 4.0.0 | packaging |
| eslint / typescript-eslint | 9.39.5 / 8.72.0 | lint |
| prettier | 3.9.10 | format |
| @types/vscode | 1.100.0 | engine ^1.100.0 |

## Decisions

- Working directory: the spec said "this empty directory" but the session started in the home directory, so the project lives in `/Users/vejaysuriyaa/rtl-live/`.
- Integration tests are bundled by esbuild to `dist/test/integration/*.test.js` (cjs, `vscode` and `mocha` external) and run by `@vscode/test-cli` with the tdd UI.
- The webview falls back to an in-page stub when `acquireVsCodeApi` is absent, so the same `dist/webview.js` runs under Playwright; posted messages are collected in `window.__rtlLiveTestHooks.posted`.
- `SchematicViewProvider` remembers the last `render`, `status`, `error` and `theme` message and replays them when a webview (sidebar or panel) becomes ready, so hide/show and "Open in editor panel" start with the current diagram.
- No `icon` field in package.json yet (vsce wants a PNG); added in M7.

## M0: scaffold and sidebar

Status: done

Verified:
- `npm run build`, `npm run typecheck`, `npm run lint` clean.
- `npm test`: 7 unit tests pass (CSP string exact, nonce on every script tag, no http/https URLs, protocol guards).
- `npm run test:integration`: VS Code stable downloaded by @vscode/test-electron, `workbench.view.extension.rtlLive` opened, `resolveWebviewView` ran, webview posted `ready` (576 ms).

Issues hit:
- npm 10.9.0 (bundled with Node 23) crashes in arborist (`Cannot read properties of null (reading 'edgesOut')`) while resolving vitest's optional peer set. Workaround: `npx -y npm@12 install`. npm 12 blocks install scripts by default, so `esbuild`, `tree-sitter-cli` and `@vscode/vsce-sign` install scripts were run by hand (`node install.js` in each package). vitest pinned to 4.1.12 (5.x needs vite 8 / rolldown which the same npm bug tripped on).
- vitest config renamed to `vitest.config.mts` to avoid the Vite ESM-in-CJS warning.
