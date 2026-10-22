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

## M1: structural layer, live module box and ports

Status: done

Grammar:
- `tree-sitter-verilog` on npm tops out at 1.0.0 (the spec said 1.0.3, which does not exist on the registry). Pinned 1.0.0.
- `tree-sitter-cli` 0.27.1 no longer has `--docker`; `tree-sitter build --wasm` downloads a wasi-sdk clang and binaryen into `~/.cache/tree-sitter` on first run, so neither emscripten nor Docker is needed (Docker Desktop was started but not used). `scripts/build-grammar.mjs` compiles the package's pre-generated `parser.c` (ABI 14) as is and records sha256 and provenance in `assets/wasm/provenance.json`; a unit test checks the hash and the CLI/runtime minor versions.
- The wasm is 18.3 MB (the Verilog/SV grammar has very large state tables). Load cost measured at 12 ms for `Language.load` plus 7 ms for `Parser.init`; parse of a 15-line module takes about 5 ms.
- Grammar quirks found and handled: (1) an identifier named `in` as the last element of a concatenation yields a MISSING `++` node (`{sr[2:0], in}`), treated as a non-error; (2) positional instantiation `mod_a u2(q2, q1, clk)` parses as `udp_instantiation`; (3) a named instantiation in a module without other items can parse as `checker_instantiation`. The parser handles all three plus `module_instantiation`, and reads connection lists from text so all forms behave the same.

Parser design:
- Instead of pattern matching the deep CST, the tree-sitter parser collects nodes of interest anywhere in the tree (works under ERROR nodes) and assigns them to module spans (module_header to endmodule, next header or EOF).
- Recovery paths for partial code: `assign` tokens under ERROR, `always_keyword` under ERROR, instance-looking ERROR text.
- Fallback scanner (`src/structural/fallbackScanner.ts`): tokenizer plus recursive descent. Both parsers share `textUtils.ts` (identifier extraction, always-block analysis, connection parsing, line index) and pass the same unit tests.

Verified:
- `npm test`: 150 unit tests; every HDLBits fixture's port list matches `test/fixtures/expected/<name>.json` for both parsers (expected files were generated from the tree-sitter parser and checked by eye against the Verilog); partial fixtures p1..p8 produce a module box or the empty state and never throw; 25 prefixes of every fixture yield a valid SchematicDoc; scheduler debounce/cancel tests; LRU cache; ELK option tests; SVG renderer test.
- `npm run test:integration`: editing `wire.v` with `TextEditor.edit` produced a `render` with ports in/out in well under 500 ms; the ELK layout engine reported `layout engine: worker`, so the Blob-URL worker runs under the real webview CSP (`worker-src blob:`).
- `npm run test:webview`: `artifacts/m1-wire.png` and `artifacts/m1-7458-structural.png`; `data-port="in"` and `data-port="out"` exist.

Decisions:
- Structural IR draws assigns and always blocks as dashed clouds labelled with the (truncated) expression; instance pins get directions from the defined module when it is in the same file, else from the connection heuristics of section 3.
- d3 transitions are not used (they need `d3-transition`, which the spec does not list), so fit/zoom are instant; node move tweening is done with CSS in M6.
- Webview bundles `elkjs/lib/elk.bundled.js` (main-thread fallback) and fetches `dist/elkWorker.js` as text for the Blob worker. Dev bundles carry inline sourcemaps (9 MB); the production build is minified without them.

Could not verify headlessly: typing feel in the real editor, font metrics of labels (sizes are estimated at 6.6 px per character).
