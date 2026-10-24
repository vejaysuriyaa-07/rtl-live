# RTL Live: work log archive

Full milestone and phase logs, moved out of NOTES.md on 2026-10-23 so the resume point stays small.
NOTES.md holds the current status, open issues, decisions and the next step; open this file only when a
section below is needed (search by milestone or version heading). Newest section at the bottom. New phase
logs are appended here, never to NOTES.md.

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

| Package                                  | Version         | Role                                                     |
| ---------------------------------------- | --------------- | -------------------------------------------------------- |
| typescript                               | 5.9.3           | strict typecheck                                         |
| esbuild                                  | 0.28.2          | all bundles                                              |
| web-tree-sitter                          | 0.27.1          | structural parser runtime                                |
| tree-sitter-cli                          | 0.27.1          | grammar wasm build (minor matches web-tree-sitter)       |
| tree-sitter-verilog                      | 1.0.0           | grammar (spec said 1.0.3; npm's latest is 1.0.0, see M1) |
| @yowasp/yosys                            | 0.70.1258       | wasm synthesis backend                                   |
| elkjs                                    | 0.12.0          | layout                                                   |
| d3-selection / d3-zoom                   | 3.0.0           | pan and zoom                                             |
| vitest                                   | 5.0.5           | unit and golden tests                                    |
| @vscode/test-cli / @vscode/test-electron | 0.0.15 / 3.1.0  | integration tests                                        |
| mocha                                    | 12.0.3          | integration test runner                                  |
| @playwright/test                         | 1.64.1          | webview tests and screenshots                            |
| @vscode/vsce                             | 4.0.0           | packaging                                                |
| eslint / typescript-eslint               | 9.39.5 / 8.72.0 | lint                                                     |
| prettier                                 | 3.9.10          | format                                                   |
| @types/vscode                            | 1.100.0         | engine ^1.100.0                                          |

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

## M2: synthesis for assign-based combinational logic with gate symbols

Status: done

Backend findings:

- Native yosys is not installed on this machine, so every synthesis check ran on `@yowasp/yosys` 0.70.1258 (wasm). The `auto` setting picks native when `yosys -V` answers; the native backend code path (`src/synth/nativeBackend.ts`) is unit-level only on this machine and should be tried once `brew install yosys` is done.
- The 0.70 yosys wasm uses the WebAssembly exception-handling proposal (`exnref`). Node 23.1 (used for vitest) rejects it with `CompileError: invalid value type 'exn'` unless `--experimental-wasm-exnref` is set; the worker sets it with `v8.setFlagsFromString` before loading the bundle. VS Code 1.143 ships Electron 43 / Chrome 150 where it is on by default, verified by the integration run (`backend: wasm 0.70`).
- The yowasp bundle resolves its wasm and resource tar with `new URL("./x", import.meta.url)`, so esbuild copies `yosys.core*.wasm` and `yosys-resources.0.tar` (about 80 MB) next to `dist/yosysWorker.mjs`.
- Measured on this machine: wasm cold start 173 to 201 ms after the first fetch (the files are read from disk, not compiled eagerly), warm runs 15 to 150 ms for the fixtures, 7458.v at 146 ms.
- Worker recycling: every 50 runs (setting not exposed; constructor option), when the reported process RSS exceeds 1.5 GB (`process.memoryUsage().rss` inside the worker, which is process wide and therefore a conservative proxy), on any timeout (10 s) and on cancellation. Each worker owns its pending-request map so a terminated worker cannot fail requests on its replacement (bug found by the N=3 recycle test).

IR:

- `src/ir/fromYosys.ts` rebuilds bus-level nets from bit ids: every driving endpoint defines one net; sinks whose bit vectors are slices, repeats or concatenations go through split/join/const nodes. This follows netlistsvg's splitter/joiner idea (MIT) but the code is original, so nothing was ported.
- Stable ids: `kind:op:sha256(kind|op|sorted named nets|ordinal)[0:10]`; ordinal is by source order among nodes with the same key. Instances keep `inst:<user name>`. The "comment line at the top" test passes for 7458, notgate, vectorgates and xnor_misc. A gate whose op is rewritten by the output-bubble rule keeps the id computed from its original op (`gate:xor:...` for an XNOR made from `~(a ^ b)`); ids only need to be stable, not descriptive.
- Simplify rules (`src/ir/simplify.ts`, each unit tested): mergeChains (1-bit associative chains over unnamed single-sink nets), dropBuffers, bubbles (input bubble for a NOT feeding one gate; output bubble turning and/or/xor into nand/nor/xnor when the only sink is a NOT). `~(a ^ b)` therefore renders as an XNOR symbol.
- `a || b` becomes a `$logic_or` cell, mapped to `gate` op `or` with 3-bit inputs and a 1-bit output.

Verified:

- `npm test`: 196 unit and golden tests. M2 fixtures (wire, wire4, notgate, 7458, gates4, xnor_misc, vectorgates) pass the expectations in `test/fixtures/expected/*.json` (`synth.raw` and `synth.simplified` blocks, checked by `test/unit/synthHelpers.ts`). Golden files `test/golden/<fixture>.ir.json` written with sorted keys and generation 0.
- 7458 raw: 6 AND + 2 OR; simplified: 4 AND (two 2-input, two 3-input) + 2 OR, nets w1..w4 named.
- Wasm backend tests: N=3 recycle with 7 runs all succeed; cancel then run; timeout (1 ms) then run; broken input reports an ERROR line.
- Integration (`npm run test:integration`, 5 passing): 7458.v reaches fidelity synthesized with 4 ANDs and 2 ORs; 20 edits 10 ms apart on notgate.v caused 1 synthesis run and 1 posted result (final generation 22), with no unhandled rejection.
- Playwright: `artifacts/m2-{7458,gates4,xnor_misc,vectorgates,notgate}.png`; two 3-input ANDs found in the DOM.

Decisions:

- Stale handling: once a document has a synthesized diagram, structural renders are not sent any more; the webview keeps the last good diagram while the status badge turns amber ("Stale", message "synthesizing" or "fix the error to resynthesize") and the banner shows the first error. The spec's "overlay newer structural boxes" is not implemented (see Known issues); a document without a synthesized diagram yet always shows the structural view.
- `npm test` builds first so the worker bundle under `dist/` is current.
- Synthesis expectations and golden files are gated by `COMPLETED_MILESTONES` in `test/unit/synthHelpers.ts`; the M3 to M5 fixtures are added as those milestones complete (`SYNTH_MILESTONES=M3 npx vitest run` runs one ahead of time).

Known issues:

- Structural boxes are not overlaid on a stale synthesized diagram.
- Bus width labels are drawn once per net near the driver; for very short first segments they can touch the port chevron.

## M3: vectors, buses, selects, concatenation, replication

Status: done

- Net naming: a net driven by an input port is named after that port even when an output port shares its bits (`assign outv = vec` previously named the net `outv`). Single-bit nets never get a split node.
- Replication `{24{in[7]}}` becomes one split output `[7]` feeding a join input labelled `[31:8] x24`; `{5{a,b,c,d,e}}` becomes a 25-input join (each bit is its own run; repeated groups are not detected).
- `~{...} ^ {...}` renders as one 25-bit XOR with an inverted A input (bubble rule).

Verified:

- `npm test`: 223 tests. vector0, vector2, vectorr, vector3, vector4, vector5 pass their expectations; golden files added.
- `test/unit/svgBus.test.ts` lays out every golden with elkjs in node and asserts that every net wider than 1 bit has a `bus-width` label in the `svg.ts` string output, that vector2's rippers read [7:0], [15:8], [23:16], [31:24], and that the largest golden lays out in under 100 ms (7458 at 68 ms cold, well under 20 ms warm).
- Playwright: `artifacts/m3-vector{0,2,r,3,4,5}.png`; bus edges and width labels present in the DOM.

## M4: instantiation, hierarchy, black boxes, drill-down

Status: done

- Black-box stubs (`src/synth/blackboxStubs.ts`): directions are decided in passes: definite (constant or top input -> input; empty or an undriven top output -> output; a wire driven by assign/always -> input), merged per module type across instances, then propagated along wires (a wire with a known output pin on the other side makes this pin an input and vice versa), then the weak rule "wire read by logic and driven nowhere -> output", else inout. The earlier single-pass version marked `my_dff.d` as output in module_shift8 because `q1` is read by the always block; the pass ordering fixes that.
- Yosys keeps user instance names, so instance nodes are `inst:<name>` and labelled `u1 : mod_a`. Instances of modules defined in the file get `drillTarget`; their module views come from the same Yosys JSON (no flatten), so drill-down needs no second run.
- Unconnected pins (`.cout()`) are detached (pin net null) instead of pointing at an orphan net.

Verified:

- `npm test`: 244 tests. module, module_pos, module_name, module_shift, module_add, module_add_full and multi_module pass, including black-box pin directions (module_pos: p0, p1 output, p2..p5 input; module_add: a, b 16-bit in, cin in, sum 16-bit out, cout out; cout_lo links lo.cout to hi.cin; `1'b0` constant on lo.cin).
- Playwright (23 passing): double-clicking `add16` in module_add_full shows the add16 module with its adder, the breadcrumb has two crumbs and clicking the first returns to top_module (this found an off-by-one in the breadcrumb handler); black boxes are dashed with the "not defined in this file" tooltip; the dropdown for multi_module lists `inv` and `top_module`. Screenshots `artifacts/m4-*.png`.

## M5: always blocks, muxes, flip-flops, counters, FSMs

Status: done

- Cell mapping (`src/ir/cellMap.ts`): `$mux` -> mux with A ("0") and B ("1") on the west and S on the south; `$pmux`/`$bmux` -> pmux with A labelled "else" and one west pin per select bit (B is split into S_WIDTH chunks); `$dff $adff $sdff $dffe $adffe $sdffe $sdffce $aldff $dlatch ...` -> dff with CLK south (triangle), optional R (ARST or SRST) and EN west, inverted pins drawn with bubbles when the polarity parameter is 0; latches get a "latch" warning badge in the tooltip.
- `proc -norom` is used from the start; module_shift8 produces a `$pmux` fed by three `$eq` comparators on `sel` (one-hot select of width 3) and no ROM or memory cell. The spec's "mux-family node with 2-bit select" therefore holds for `sel` itself (2 bits into the comparators); the pmux select is the 3-bit one-hot join.
- counter4: `$dff` plus a `$mux` for the synchronous reset (Yosys does not fold it into `$sdff` without `opt_dff`), `$add` with the `q` feedback and `4'b0001` / `4'b0000` constant pills.
- mux2_always: the ternary and the always version each get their own `$and` and `$mux`; Yosys does not share them at this pass level (recorded as requested).
- fsm_moore: `out = (state == B)` with `B = 1'b1` is simplified by Yosys to `out = state`, so the register's Q net carries both names. Nets now record `aliases` (other user names for the same bits), shown in the net tooltip; `src/ir/fsmInfo.ts` marks a DFF as a state register when its Q net name or alias is assigned or read in an always block that also reads a localparam, and adds `states: A = 1'b0, B = 1'b1` to the tooltip.
- Golden files for wire, wire4 and vector0 changed only by the new `aliases` field (reviewed with diff, regenerated with `npm run test:golden:update`).

Verified:

- `npm test`: 272 tests. mux2_always, module_shift8, dff_async, counter4, shift4, fsm_moore and arith_compare pass their expectations; with `opt -fast` on and off no unknown-cell boxes appear for any of them.
- Playwright (32 passing): `artifacts/m5-*.png`; counter4 has a DFF with a clock triangle, an adder and a mux; the fsm_moore DFF tooltip lists `states: A = 1'b0, B = 1'b1`.

## M6: UX polish

Status: done

- Cursor linking: every node, port and net element carries `data-src="l:c:el:ec;..."` (all source ranges, so a merged 3-input AND lights up for any of its original expressions). The webview toggles `.highlight` on cursor messages and posts a `highlighted` message with the ids, which the integration test reads through `provider.lastHighlighted`.
- Click on a node or port posts `revealSource`; the host moves the selection and reveals the range. `provider.simulateWebviewMessage` is a test hook that runs the same dispatch path as a real webview message.
- Stale handling: deleting `endmodule` leaves the synthesized diagram on screen (the host does not send a structural render once a document has a synthesized one), status turns to "Stale" with the first error in the banner (clicking it jumps to the line); undo resynthesizes from the cache.
- Theme: colours come only from VS Code CSS variables; the host posts the theme kind on activation and `onDidChangeActiveColorTheme`, which only sets `body[data-theme]` (high-contrast gets thicker strokes). Light, dark and high-contrast screenshots under `artifacts/m6-*-{light,dark,hc}.png` use the Playwright harness variable sets.
- Animation: nodes and ports that moved between renders tween for 150 ms with a CSS transform that undoes the move and transitions back; skipped under `prefers-reduced-motion`. Could not be verified visually headlessly; the code path runs in every Playwright re-render.
- Export: SVG is self-contained (resolved theme variables and the schematic rules are inlined, background rect added); PNG renders the SVG at 2x into a canvas. The exported SVG parses as XML in Chromium with no `http(s)://`, `url(`, `xlink:href`, `<link>`, `<script>` or `@import` besides the SVG namespace. Saved files go through `showSaveDialog` next to the source file.
- "Open in editor panel" reuses `dist/webview.js` in a `WebviewPanel`; both webviews receive every message and replay the last render/status/error/theme when they become ready.
- Keys: `f` fit, `+`/`=` and `-` zoom, `Backspace` drill up.

Verified:

- Integration (8 passing): cursor on `assign out = ~in` highlights `gate:not:...`; moving to line 1 clears it; `revealSource` moves the selection to line 9 columns 16..23 of 7458.v; deleting `endmodule` gives status stale while the last render message still holds the synthesized 6-node diagram, and undo returns to synthesized.
- Playwright (47 passing in all): theme screenshots, export SVG XML check (`artifacts/m6-7458-export.svg`), cursor highlight of the OR gate on line 9, keyboard zoom and fit.
- `npm test`: 272 tests.

## M7: performance, packaging, docs

Status: done

### Bench (`npm run bench`, `artifacts/bench.json`, 2026-10-22, Node v23.1.0, wasm backend only)

Columns: structural = parse + structural IR p95 over 30 runs (ms); wasm warm = synthesis p50 / p95 over 7 warm runs (ms); ELK = elkjs layout in node p50 / max over 5 runs (ms).

| fixture           | nodes | structural tree-sitter p95 | structural fallback p95 | wasm warm p50 / p95 | ELK p50 / max |
| ----------------- | ----- | -------------------------- | ----------------------- | ------------------- | ------------- |
| 7458.v            | 6     | 5.0                        | 1.4                     | 33 / 55             | 20.3 / 115.2  |
| arith_compare.v   | 4     | 2.1                        | 0.3                     | 12 / 17             | 10.0 / 17.8   |
| counter4.v        | 5     | 1.3                        | 0.2                     | 13 / 16             | 15.4 / 22.1   |
| dff_async.v       | 1     | 0.6                        | 0.0                     | 14 / 23             | 8.0 / 12.5    |
| fsm_moore.v       | 7     | 1.1                        | 0.1                     | 15 / 18             | 16.5 / 28.8   |
| gates4.v          | 3     | 0.4                        | 0.0                     | 10 / 14             | 5.7 / 6.5     |
| module.v          | 1     | 0.5                        | 0.1                     | 31 / 331            | 8.1 / 9.3     |
| module_add.v      | 6     | 2.0                        | 0.1                     | 17 / 21             | 9.4 / 14.5    |
| module_add_full.v | 6     | 2.5                        | 0.3                     | 13 / 18             | 9.8 / 10.1    |
| module_name.v     | 1     | 0.5                        | 0.0                     | 11 / 14             | 7.1 / 8.6     |
| module_pos.v      | 1     | 0.6                        | 0.0                     | 12 / 14             | 6.4 / 6.8     |
| module_shift.v    | 3     | 1.4                        | 0.0                     | 12 / 16             | 5.8 / 6.4     |
| module_shift8.v   | 11    | 1.8                        | 0.1                     | 27 / 373            | 30.6 / 35.0   |
| multi_module.v    | 1     | 0.7                        | 0.0                     | 13 / 17             | 4.9 / 6.6     |
| mux2_always.v     | 4     | 0.6                        | 0.0                     | 15 / 19             | 14.9 / 22.4   |
| notgate.v         | 1     | 0.1                        | 0.0                     | 22 / 36             | 5.0 / 5.5     |
| shift4.v          | 3     | 0.6                        | 0.0                     | 12 / 18             | 7.8 / 8.0     |
| vector0.v         | 1     | 0.6                        | 0.0                     | 10 / 11             | 5.0 / 6.7     |
| vector2.v         | 2     | 1.0                        | 0.0                     | 11 / 261            | 6.4 / 7.8     |
| vector3.v         | 8     | 0.5                        | 0.0                     | 13 / 16             | 9.6 / 10.3    |
| vector4.v         | 2     | 0.4                        | 0.0                     | 10 / 12             | 5.2 / 7.3     |
| vector5.v         | 3     | 0.8                        | 0.0                     | 14 / 16             | 14.1 / 28.2   |
| vectorgates.v     | 5     | 0.7                        | 0.0                     | 17 / 27             | 8.5 / 9.1     |
| vectorr.v         | 2     | 1.2                        | 0.1                     | 11 / 12             | 6.4 / 7.0     |
| wire.v            | 0     | 0.1                        | 0.0                     | 10 / 12             | 4.1 / 4.7     |
| wire4.v           | 0     | 0.4                        | 0.0                     | 21 / 28             | 5.6 / 6.2     |
| xnor_misc.v       | 3     | 0.6                        | 0.0                     | 13 / 17             | 7.2 / 8.7     |

Worst cases: structural tree-sitter p95 5.0 ms, fallback 1.4 ms, wasm warm p95 373 ms, ELK max 115 ms, wasm cold start 230 ms (preload of a fresh worker).

Budgets (section 9):

- Structural, keystroke to render under 100 ms p95: met in the parser (5 ms p95). End to end inside VS Code the integration test measured 412 to 416 ms for one edit, which includes the 60 ms debounce, the extension host round trip and the test's own event plumbing; the structural pass itself logs a warning above 100 ms and never did.
- Native yosys under 300 ms p95: not measurable here (no native yosys installed). The native backend is exercised only by its code path; try it after `brew install yosys` and rerun `npm run bench`.
- Wasm warm under 800 ms p95: met (373 ms). The outliers (module.v 331 ms, module_shift8.v 373 ms, vector2.v 261 ms) are the runs right after a worker recycle (every 50 runs; the bench does 216 runs), which pay the cold start again. Typical warm runs are 11 to 55 ms.
- Wasm cold start under 8 s with a warm-up indicator: met (230 ms here; the "Warming up" badge shows until the preload resolves).
- ELK under 100 ms for the largest fixture: met for warm runs (max p50 30.6 ms for module_shift8; 7458 at 20 ms). The 115 ms max for 7458 is the very first layout in a fresh node process (JIT warm-up); inside the webview the worker is warmed with a probe layout at start.
- Activation under 300 ms: met (2.7 ms inside `activate()`; the grammar and the wasm engine load afterwards in the background).

### Packaging

- `npm run package` runs the production esbuild (minified, no sourcemaps) and `vsce package --no-dependencies`.
- `npx vsce ls --no-dependencies` lists 21 files: package.json, README.md, CHANGELOG.md, LICENSE, THIRD_PARTY_NOTICES.md, media/icon.png, media/activity-icon.svg, dist/extension.js, dist/webview.js, dist/webview.css, dist/elkWorker.js, dist/yosysWorker.mjs, dist/web-tree-sitter.wasm, dist/tree-sitter-verilog.wasm, dist/yosys.core.wasm, dist/yosys.core2.wasm, dist/yosys.core3.wasm, dist/yosys.core4.wasm, dist/yosys-resources.0.tar. No node_modules entries.
- `rtl-live-0.1.0.vsix`: 18,260,732 bytes on disk (vsce reports 17.41 MB packed; the two big wasm files compress well).
- vsce refuses relative images in README without a repository URL, so the README points at `media/screenshots/` instead of embedding them.
- `code --install-extension rtl-live-0.1.0.vsix --force` succeeded with the CLI inside `~/Applications/Visual Studio Code.app` (not on PATH); `code --list-extensions --show-versions` shows `vejaysuriyaa.rtl-live@0.1.0`.
- Icon: `scripts/render-icon.mjs` renders `media/icon.svg` to the 128x128 PNG vsce requires.

### Final verification checklist (section 12)

1. `npm ci && npm run build && npm run typecheck && npm run lint`: clean (npm ci worked with npm 10.9.0 once the lockfile existed; the initial install needed npm 12, see M0).
2. `npm test`: 272 passing; golden snapshots unchanged since the M5 commit.
3. `npm run test:integration`: 8 passing (M0 sidebar, M1 render timing and ELK worker under CSP, M2 synthesis and cancellation, M6 cursor linking, revealSource, stale banner).
4. `npm run test:webview`: 47 passing, light, dark and high-contrast screenshots in `artifacts/`.
5. Bench table above, compared against the budgets.
6. `.vsix` built, `vsce ls` output and size recorded above.
7. `git log --oneline` shows one commit per milestone (M0 to M7); `git remote -v` prints nothing.
8. `grep -o "https\?:[^\"' )]*" dist/webview.js` finds only XML namespace and EMF metadata constants inside elkjs (`http://www.w3.org/2000/svg`, `http://www.w3.org/1999/xlink`, `http://www.eclipse.org/elk/ElkGraph`, `http://www.w3.org/2001/XMLSchema#...`); none is fetched at runtime.
9. README contains the morning checklist under "First run".

### Could not verify headlessly

Visual quality at real DPI and with the real VS Code font, typing feel and the 150 ms tween, the editor panel side by side with the sidebar, the native yosys path, the save dialogs for export.

### Known issues and next steps

- Structural boxes are not overlaid on a stale synthesized diagram; the last good diagram stays until the file synthesizes again.
- Replicated groups (`{5{a,b,c,d,e}}`) expand to one join input per bit.
- `$logic_and`/`$logic_or` draw as AND/OR symbols with bus inputs; a distinct glyph would help.
- Bus width labels can touch the port chevron on very short first segments.
- The yowasp wasm needs the `exnref` flag on Node below 24; the worker sets it. If a future VS Code ships an older V8, the wasm backend will fail to compile and the extension falls back to the structural view (logged).
- Next: cursor highlight for nets by name (only declaration ranges today), a "logic" glyph for logical operators, an outline of module ports when the file has several modules, and native yosys measurements.

## Addendum: native yosys measured (2026-10-22)

`brew install yosys` installed Yosys 0.70+post (`/opt/homebrew/bin/yosys`). Rerun of `npm run bench`:

| fixture           | nodes | native warm p50 / p95 (ms) | wasm warm p50 / p95 (ms) |
| ----------------- | ----- | -------------------------- | ------------------------ |
| 7458.v            | 6     | 12 / 14                    | 33 / 39                  |
| arith_compare.v   | 4     | 10 / 11                    | 12 / 12                  |
| counter4.v        | 5     | 12 / 13                    | 11 / 12                  |
| dff_async.v       | 1     | 11 / 11                    | 11 / 12                  |
| fsm_moore.v       | 7     | 11 / 11                    | 11 / 14                  |
| gates4.v          | 3     | 10 / 11                    | 9 / 11                   |
| module.v          | 1     | 13 / 13                    | 19 / 303                 |
| module_add.v      | 6     | 12 / 13                    | 15 / 28                  |
| module_add_full.v | 6     | 12 / 12                    | 13 / 17                  |
| module_name.v     | 1     | 12 / 13                    | 11 / 12                  |
| module_pos.v      | 1     | 10 / 13                    | 11 / 12                  |
| module_shift.v    | 3     | 11 / 11                    | 10 / 13                  |
| module_shift8.v   | 11    | 19 / 21                    | 25 / 358                 |
| multi_module.v    | 1     | 11 / 14                    | 14 / 18                  |
| mux2_always.v     | 4     | 11 / 11                    | 13 / 14                  |
| notgate.v         | 1     | 11 / 12                    | 10 / 13                  |
| shift4.v          | 3     | 10 / 11                    | 13 / 17                  |
| vector0.v         | 1     | 11 / 12                    | 11 / 12                  |
| vector2.v         | 2     | 12 / 12                    | 10 / 277                 |
| vector3.v         | 8     | 11 / 11                    | 13 / 16                  |
| vector4.v         | 2     | 12 / 13                    | 10 / 12                  |
| vector5.v         | 3     | 14 / 16                    | 13 / 15                  |
| vectorgates.v     | 5     | 10 / 12                    | 13 / 15                  |
| vectorr.v         | 2     | 10 / 11                    | 10 / 11                  |
| wire.v            | 0     | 10 / 10                    | 9 / 11                   |
| wire4.v           | 0     | 10 / 12                    | 17 / 34                  |
| xnor_misc.v       | 3     | 13 / 14                    | 13 / 18                  |

- Native warm p95 worst case 20.6 ms (module_shift8), typical 11 to 14 ms including temp-dir setup and process spawn; budget of 300 ms met.
- Wasm warm p95 358 ms, same recycle outliers as before; structural p95 4.7 ms; ELK max 73 ms; wasm cold start 226 ms.
- With native yosys present, `npm test` (272) and the golden files pass unchanged: the native and wasm builds of Yosys 0.70 produce identical IR for every fixture. `npm run test:integration` (8 passing) reports `backend: native 0.70+post`.

## Addendum: installed vsix bugs (2026-10-22)

Report: the installed `rtl-live-0.1.0.vsix` (1) logs `tree-sitter grammar unavailable (The argument 'filename' must be a file URL object, file URL string, or absolute path string. Received undefined); using fallback scanner` on activation and (2) shows a blank "RTL Live: Schematic" view with `7458.v` open.

### Reproduction against the production build

- `npm run build:prod`, then `npx playwright test` (47 passing) and `npx vscode-test` (8 passing) against the minified bundles in dev mode.
- New `npm run test:packaged` (`scripts/test-packaged.mjs` + `.vscode-test.packaged.mjs`): `build:prod`, `vsce package` into a temp dir, unzip, and run the integration suite with `extensionDevelopmentPath` pointing at the unzipped `extension/` folder. Env knobs: `RTL_LIVE_VSCODE_VERSION` (default stable), `RTL_LIVE_VSCODE_PATH` (use an installed app binary instead of a download), `RTL_LIVE_EXTENSIONS_DIR` (enable an existing extensions folder instead of `--disable-extensions`).

### Bug 1: grammar never loaded (fixed)

Root cause: `web-tree-sitter` 0.27.1 has `exports` with an `import` condition (ESM `web-tree-sitter.js`) and a `require` condition (cjs `web-tree-sitter.cjs`). The extension source uses `import`, so esbuild picked the ESM file and inlined it into the cjs bundle, where `import.meta` becomes `{}`. The ESM file runs `createRequire(import.meta.url)` under Node, which throws the error above. `createStructuralParser` caught it and returned the fallback scanner. This affected the dev bundle as well; the integration suite passed because no test asserted which parser was active, and the unit tests import the TypeScript sources through vitest, where `import.meta.url` is real.

Fix: `esbuild.config.mjs` (options shared by `esbuild.mjs` and the tests) adds `treeSitterCjsPlugin`, an `onResolve` plugin that maps the bare `web-tree-sitter` specifier to `node_modules/web-tree-sitter/web-tree-sitter.cjs` for the extension bundle. The cjs build locates itself with `__filename`/`__dirname`, which esbuild leaves as runtime references. `grammar.ts` still passes `locateFile`, so the wasm comes from `dist/`.

Regression tests: `test/unit/bundle.test.ts` builds the extension-host bundle (dev and production options) with a stdin entry that re-exports `createStructuralParser`, loads it with `require()` and asserts the parser is `tree-sitter` with no fallback reason (this failed with the exact reported message before the fix). `test/integration/m1.structural.test.ts` now asserts `parser.name === "tree-sitter"`.

### Bug 2: blank sidebar (not reproduced)

Every configuration below rendered 7458.v and posted `ready` (`layout engine: worker`, fidelity synthesized), using the unchanged 0.1.0 vsix bytes:

| VS Code                         | extension loaded as                                                  | other extensions               | launch                                                                        |
| ------------------------------- | -------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| 1.143.0 (test download)         | unzipped vsix, dev mode                                              | disabled                       | vscode-test                                                                   |
| 1.106.3 (download)              | unzipped vsix, dev mode                                              | disabled                       | vscode-test                                                                   |
| 1.106.3 `~/Applications` binary | unzipped vsix, dev mode                                              | `~/.vscode/extensions` enabled | vscode-test                                                                   |
| 1.143.0                         | unzipped vsix, dev mode                                              | `~/.vscode/extensions` enabled | vscode-test                                                                   |
| 1.106.3 `~/Applications` app    | installed with `code --install-extension` into a temp extensions dir | none                           | `open -a` (translocated, like the real app) with a probe `extensionTestsPath` |
| 1.106.3 `~/Applications` app    | installed by the CLI into the running window, no reload              | none                           | `open -a`                                                                     |

Findings from `~/Library/Application Support/Code/logs`:

- Two VS Codes share the profile: 1.106.3 from `~/Applications` (quarantined, runs App-Translocated from `/private/var/folders/.../AppTranslocation/...`) and the 1.143.0 copy that `@vscode/test-electron` downloaded into `.vscode-test/`, which was launched from Finder at 02:03 and is where `rtl-live` activated at 02:09 and 02:11 (after a window reload) with the pasted log. That window had `mshr-h.veriloghdl`, `lramseyer.vaporview` and other extensions active.
- Neither main process logged a `Refused to load`/`Blocked vscode-webview request` for the extension, and the webview never posted a `log` message, so the host cannot tell whether the HTML loaded. `ready` was not logged by the host at all, so "the log never shows the webview posting ready" was true even in working sessions.
- Running the integration suite with the user's extensions enabled saves the test edits into `test/fixtures/hdlbits/*.v` (an autosave extension) and shifts generation counts (`25 !== 23` in the M2 cancellation test). `test:packaged` keeps `--disable-extensions` unless `RTL_LIVE_EXTENSIONS_DIR` is set. The two dirty fixtures were reverted with `git checkout`.

Diagnostics added so the next blank view explains itself in "RTL Live: Show Log":

- Host: `sidebar webview script <uri>` when the HTML is set, `sidebar webview resolved (visible: ...)`, `<kind> webview ready, replaying N message(s)`.
- Webview: an inline nonce'd boot script (`BOOT_SCRIPT` in `webviewHtml.ts`) runs before `dist/webview.js`. It owns the single `acquireVsCodeApi()` call (`webview/vscodeApi.ts` reuses it via `window.__rtlLiveVsCodeApi`), posts `webview booting (vscode api)`, and reports `failed to load <uri>` for a script or stylesheet that does not load, `uncaught <message> at <file>:<line>` and `unhandled rejection: ...`. Unit tests check the boot script is nonce'd, precedes the bundle and has no http URLs; the CSP string is unchanged.

Next time it happens: open the view, run "RTL Live: Show Log", and copy the lines after `sidebar webview script`. "Developer: Open Webview Developer Tools" (Command Palette) opens the console of the view. Also note which VS Code is running: `Code: About` shows 1.106.3 for `~/Applications` and 1.143.0 for the `.vscode-test` copy.

### Verification

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 276 passing (2 new bundle tests, 2 new html tests).
- `npm run test:integration`: 8 passing (M1 now asserts the tree-sitter parser).
- `npm run test:webview`: 47 passing.
- `npm run test:packaged`: 8 passing on 1.143.0 against the packaged vsix; grammar loads.
- Rebuilt `rtl-live-0.1.0.vsix` and reinstalled with `"$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension rtl-live-0.1.0.vsix --force`; see the install log below.

Install log (2026-10-22 02:32, `code --install-extension rtl-live-0.1.0.vsix --force` from `~/Applications/Visual Studio Code.app`): "Extension 'rtl-live-0.1.0.vsix' was successfully installed." The installed `dist/extension.js` (169,587 bytes) has no `import_meta` reference and contains the boot script. A probe launch of the same app through LaunchServices (translocated, installed mode, 7458.v open) logged:

```
structural parser: tree-sitter
sidebar webview script https://file%2B.vscode-resource.vscode-cdn.net/.../dist/webview.js
sidebar webview resolved (visible: true)
synthesis backend: native yosys 0.70+post at /opt/homebrew/bin/yosys
[webview] webview booting (vscode api)
sidebar webview ready, replaying 3 message(s)
[webview] layout engine: worker
```

Both running VS Code windows (1.106.3 and the 1.143.0 copy) still hold the old 0.1.0 files until "Developer: Reload Window".

## v0.2 work log (2026-10-22)

### Phase 0: baseline and missing inputs

Baseline on the v0.1.0 tree (`npm run build && npm run typecheck && npm run lint && npm test && npm run test:integration && npm run test:webview && npm run test:packaged`): typecheck and lint clean; unit and golden 276 passing (15 files); integration 8 passing; webview 47 passing; packaged 8 passing.

The v0.2 brief refers to `docs/BUGS.md` (12 bugs), `docs/ACCURACY.md` (sections 2 to 6, fixture list 5.2, editing cases 5.3) and `docs/BUG_HUNT.md` (Parts A to C). None of these files exists in the repository, in git history, or anywhere on this machine (`mdfind`, `find ~`). Work proceeds from the requirements that the brief itself spells out (bug 2, 3, 4, 9, 11, 12 and the Phase 2, 4, 5, 6 bullet lists). Items that only the missing documents define (bugs 1, 5, 6, 7, 8, 10; the 5.2 fixture list; the 5.3 editing cases; Part A checklist items beyond the A2 semantics list) are marked PARTIAL below with what was done instead.

### Phase 1: test isolation (bug 12)

- `test/isolation.mjs`: `isolatedLaunch(label)` creates `rl-<label>-XXXXXX` under the OS temp dir with `ud/` (user data), `ext/` (extensions) and `fixtures/` (a copy of `test/fixtures`), returns the launch args (`--user-data-dir`, `--extensions-dir`, `--disable-extensions`, `--disable-workspace-trust`, `--skip-welcome`, `--skip-release-notes`, `--disable-telemetry`) and removes the folder when the test CLI exits. Short names on purpose: the IPC socket lives under the user-data dir and macOS caps socket paths at about 103 characters (a launch with a long dir exits silently with `ENOTSOCK`).
- `.vscode-test.mjs` and `.vscode-test.packaged.mjs` both use it; the packaged config no longer accepts `RTL_LIVE_VSCODE_PATH` or `RTL_LIVE_EXTENSIONS_DIR` (those pointed at the real app or the real extensions folder). `RTL_LIVE_VSCODE_VERSION` remains.
- Integration tests open fixtures through `openFixture()` / `fixturePath()` in `test/integration/util.ts`, which assert that the workspace is not the repository fixtures folder.
- Playwright tests never launch VS Code; they read fixtures read-only to build documents and post them to the harness page. The downloaded VS Code under `.vscode-test/` is only ever started by `@vscode/test-cli` with the args above.
- Guard: `test/unit/isolation.test.ts` imports both configs and checks the three dirs are under the temp dir and not under `~/Library` or `~/.vscode`, that `--disable-extensions` is set, that no config, script or test file mentions the real profile, extensions folder, `fromMachine` or the removed env knobs, and that integration tests do not read `workspaceFolders` or build `fixtures` paths themselves.

How to run everything without touching the real VS Code: `npm test`, `npm run test:integration`, `npm run test:webview`, `npm run test:packaged`. Never open `.vscode-test/vscode-darwin-arm64-*/Visual Studio Code.app` by hand; it shares the real profile when launched from Finder. To try a build in the real VS Code, use `npm run package` and `"$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension rtl-live-<version>.vsix --force`, then "Developer: Reload Window".

### Phase 2: accuracy measurement

What was built (no fixes yet):

- `src/ir/toVerilog.ts`: exports a SchematicDoc as a structural Verilog netlist (one wire per net, one assign or always block per node, instances for submodules and black boxes). Anything the IR cannot describe exactly throws an `ExportError` with the reason, so a functional check fails as "not exportable: ..." instead of simulating a guessed netlist. Deliberate refusals: logic clouds (structural view), unknown cells, `$bmux`, `$dffsr`/`$sr`/`$aldff`, signed arithmetic (the IR has no signedness), and a gate whose output is 1 bit while an input is wider, because the IR currently maps `$logic_and`/`$logic_or` to the same gate op as `$and`/`$or`.
- `test/accuracy/equivalence.ts` (L1): the original source and the export are each compiled with Icarus (`iverilog -g2012`, `vvp -n`) next to a generated testbench that applies the same seeded random vectors (128 for combinational designs, 64 cycles for clocked ones, clock inputs found through flip-flop CLK pins, sampled before and after each edge). Outputs are compared bit by bit; bits that are x or z on either side are skipped and counted (`maskedBits`), because `if (x)` in the source takes the else branch while a gate-level mux merges, and designs without reset start in x. Modules the file instantiates but does not define (HDLBits `mod_a`, `my_dff`, `add16`) get the same deterministic behavioral stub on both sides, so the surrounding logic is what gets compared.
- `test/accuracy/layout.ts` (L3): ELK layout in node plus the pure SVG renderer, then a walk over the markup that recovers every text box in diagram coordinates (font sizes from `webview/styles.css`, 0.6 em per character). Checks: label inside its symbol, no two labels overlap, every drawn bus has a width label, Fit at or below 100 percent (`FIT_MAX_SCALE` in `webview/render/geometry.ts`, currently 2, now shared with the zoom controller), no wire segment crosses a symbol other than its endpoints (Liang-Barsky against each node box).
- `test/accuracy/accuracy.test.ts`: every fixture, structural view and gate view, L1/L2/L3. Writes `artifacts/accuracy.json`; `scripts/accuracy-report.mjs` (run by `npm test`) renders `docs/ACCURACY_REPORT.md`. `test/accuracy/known-failures.json` lists the accepted failures; a new failure or a stale entry fails the suite. `npm run test:accuracy:update` rewrites the baseline (review the diff before committing).
- `test/accuracy/harness.test.ts`: each detector is fed a known-bad input (and swapped for or, dropped bubble, wrong reset value, cloud, label too wide, overlapping labels, missing bus label, wire through a box). The first version of the wire check never fired for horizontal segments (parallel-edge case in the clipper inverted); the harness test caught it.
- New fixtures with expectations written to the v0.2 rules (so they fail L2 until Phase 4): `case_mux.v` (one 4:1 mux, no comparators), `dff_enable.v` (dffe with EN pin, no mux), `dff_sync_reset_en.v` (sdffe), `latch_en.v` (latch, no CLK, warning), `logic_ops.v` (`&&`, `||`, `!` marked logical), `ternary.v` (2:1 mux with 0/1 labels), `nand_nor.v` (3-input NAND and NOR with output bubbles). `NodeCheck` gained `pinLabels` and `noPins`.

Baseline (docs/ACCURACY_REPORT.md): structural view L1 4/34 (only instance-only files export; clouds have no netlist), L2 34/34, L3 0/34; gate view L1 32/34, L2 29/34, L3 0/34. Real findings behind the numbers: logical operators are not distinguishable from bitwise ones in the IR (`vectorgates.v`, `logic_ops.v` L1); `case` produces `$pmux` plus two `$eq` cells, `if (en)` produces a `$dff` plus `$mux` (no `opt_dff`/dffe), `~(a & b & c)` ends as AND plus NAND (bubble rule runs before chain merging); every L3 fails on Fit above 100 percent, and on top of that bus width labels sit on ripper labels, instance titles overlap the first pin label, and the LATCH title overlaps its EN pin.

PARTIAL: ACCURACY.md section 5.2 fixtures and 5.3 editing cases are unknown (file missing); the fixtures above cover the features the brief names. Editing cases are added in Phase 3 as regression tests for bugs 2, 3 and 9.

### Phase 3: bug fixes (done 2026-10-22)

| Bug                                      | Status                                                                                                            | Commit               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1 module title overflows, Fit above 100% | fixed: frame grows to its title, `FIT_MAX_SCALE` 1, L3 checks the title                                           | `cd9e22e`            |
| 2 badge and drawing disagree             | fixed: last good diagram stays with "Stale" and overlaid port changes; structural view with errors says "Editing" | `fa4d083`, `dd00a4a` |
| 3 vague error messages, dropped ports    | fixed: specific messages with end-of-file positions, Verilator refinement, recovered ports greyed                 | `bbc3cdd`, `dd00a4a` |
| 4 sidebar stuck after sleep              | fixed: heartbeat, resync on focus and visibility, active editor re-read                                           | `86d1103`            |
| 5 logical vs bitwise                     | fixed in the IR and export; drawn with a `&&`/`                                                                   |                      | ` glyph (Phase 4 adds the nonzero reducer look) | `9604f48` |
| 6 structural overlay on stale            | fixed for ports (added, removed, changed)                                                                         | `fa4d083`            |
| 7 replicated groups                      | fixed: `{5{a,b,c,d,e}}` is one join of the group into an `x5` pin                                                 | `dd00a4a`            |
| 8 bus label on the chevron               | fixed: label on the longest segment, L3 clearance check against symbols and chevrons                              | `cd9e22e`            |
| 9 untitled files                         | fixed: Verilog-mode untitled renders, Plain Text gets a one-click hint                                            | `fa4d083`            |
| 10 ports in a grid                       | fixed: ports own the first and last layers, components not separated                                              | `cd9e22e`            |
| 11 blank webview in a new window         | fixed: ready watchdog, retry, failure page with Reload Window                                                     | `86d1103`            |
| 12 tests share the real profile          | fixed: Phase 1                                                                                                    | `fecd4d6`            |

Also fixed on the way: host messages were ordered per document, so a long-edited file silenced a freshly opened one (`8567cf3`).

Gate: typecheck and lint clean; unit 383 (24 files); integration 16; webview 50; packaged 16; `git status` clean under `test/fixtures/`. Accuracy report: structural L1 4/34, L2 34/34, L3 24/34; gate L1 34/34, L2 29/34, L3 25/34 (remaining L3: bus width labels on ripper labels, instance titles over the first pin label, LATCH over EN; remaining L2: case mux, enable and sync-reset flops, nand/nor chains, all Phase 4).

Note on expected files: `test/fixtures/expected/*.json` are not edited for fixes; new assertions go into unit tests (bug 7 lives in `synth.test.ts`) or new expected files for new fixtures.

### Phase 4: RTL view, gate view and symbol rules (done 2026-10-22, `4cfc6a4`)

- Two Yosys scripts (`src/synth/script.ts`, `view`): RTL runs `proc; opt_clean; opt_dff; opt_clean` (enables and resets fold into `$dffe`/`$sdff`, no `opt_expr` so written comparators and muxes survive); gate keeps `proc; opt_clean; opt_expr -mux_undef; opt_clean`. `SchematicDoc.view` records which one a doc is.
- `src/ir/rtlView.ts`: a `$pmux` whose select bits are `$eq(sel, k)`, `$logic_not(sel)` (k = 0) or, for a 1-bit selector, the bit and its `$not`, becomes one N:1 mux with inputs labelled by select value, the selector net on `S` (width shown), the comparator and constant helpers removed, and an undefined default dropped when every value is covered (`info.select = "value"`, exported as an `==` chain). `mux4_case` shows `0 1 2 3`, `module_shift8` the same with a 2-bit `sel`, `fsm_moore` a 2:1 by state.
- Simplify order is now buffers, chains, bubbles, chains, so `~(a & b & c)` is one 3-input NAND (`inverted_gates`, `nand_nor`).
- Latches: no CLK pin so no triangle; every node with warnings draws a small badge (`warningBadge` in `symbols.ts`).
- Host: `Controller.activeView` (persisted in `workspaceState`), both views cached per text and view, the shown view synthesized first and the other in the background so the toggle is instant; `setView` message from the toolbar; `StatusInfo.view`; the badge reads "RTL view" or "Gate view". Integration test `m9.views.test.ts` (en_flop: EN pin in RTL, mux with Q on input 0 in gate), Playwright toggle and latch tests.
- Expected files: `synth.simplified` renamed to `synth.rtl` (mechanical), `synth.gate`, `rtlModules` and `gateModules` added; `fsm_moore.json`'s reset-mux assertion moved to its gate block and an `sdff` assertion added to rtl (the view split made the old assertion gate-only). The nine 5.2 fixtures have per-view expectations. 5.1 rows that the expected files did not cover are unit tests in `synth.test.ts` ("ACCURACY.md 5.1 rows"). Goldens: every `<fixture>.ir.json` gained `"view": "rtl"`; counter4, fsm_moore and module_shift8 changed shape as intended; `<fixture>.gate.ir.json` added for every synthesized fixture.
- Deviation to know: Yosys's Verilog front end folds `state == B` with a 1-bit constant into the state bit before any pass runs (also with `read_verilog -noopt`), so `fsm_moore` shows `out` driven by the register, not a `==` box. Comparators the front end keeps (`compare4`, `arith_compare`) stay.
- Accuracy report after this phase: structural L1 4/43 (clouds), L2 43/43, L3 39/43; rtl L1 43/43, L2 43/43, L3 32/43; gate L1 43/43, L2 5/5 asserted (n/a elsewhere), L3 32/43. L3 leftovers are Phase 5: bus width labels on ripper labels, instance titles over the first pin label, LATCH title over EN.

### Phase 5 (reduced): readability (done 2026-10-22, `b4ba3ba`)

Fast-track scope: only the remaining L3 failures. Titled boxes (instances, black boxes, unknown cells) reserve an 18 px title row and flip-flops carry their title at the top, both through `elk.spacing.portSurrounding`; fan-out edges merge (`elk.layered.mergeEdges`) so a trunk splits at junction dots; clock and reset nets carry `role` (CSS hooks `net.clock`, `net.reset`); inout ports are hexagons; every layout coordinate is rounded to whole pixels; ripper labels hang right of the bar on both sides (a join input shows `xN` and keeps its range in the tooltip); the width label goes on the first wire of a bus that can carry it and never on a slice that already shows its range (L3 counts the ripper range as that slice's width label). Result: L3 43/43 in all three views.

### Phase 6 (reduced): semantic warnings (done 2026-10-22)

`src/ir/semantics.ts`: a signal assigned by more than one `assign` or `always` gets the "multiple drivers" badge on its wire and an error in the banner (Yosys merges the drivers silently, so the structural finding is carried into both synthesized views); a cycle through combinational nodes (flops, instances, black boxes, constants and sequential always clouds break it) marks every net on the cycle with "combinational loop" and a warning diagnostic. Badges are a small triangle on the wire with the text in the tooltip; the wire is dashed in the warning colour. Fixtures live in `test/fixtures/semantics/` (outside the accuracy set: a zero-delay loop would hang Icarus). Tests: `test/unit/semantics.test.ts`, Playwright `m7.states.spec.ts`.

### Manual checks (BUG_HUNT.md Part A items not automated)

Run in a scratch folder outside the repo with the installed vsix. Expected results in brackets.

A1 live typing: paste a whole file then Cmd+Z twenty times fast [no stuck or stale diagram]; CRLF and tab files [hover and click land on the right line and column]; `` `define WIDTH 8 `` in a port [no crash, width unknown shows as `?`]; `parameter N = 8` with `input [N-1:0] a` [width 8 after synthesis, `?` in the structural view]; big-endian `[0:7]`, `[0:0]`, `[127:0]`, `signed` ports [widths right]; non-ANSI header [ports drawn]; two modules neither named `top_module` [first module is top, dropdown switches]; empty file and comment-only file [empty state]; delete one `;` mid-file [rest of the diagram survives, banner says `missing ';'`].

A2 semantics: undriven output and unused input [not yet badged, see Deferred]; incomplete `if` in `always @(*)` [LATCH box with the badge]; `case` with and without `default` [latch only when a value is missing]; `<=` versus `=` shift register [different flop chains]; async reset [R pin, tooltip "async"]; priority `if / else if / else` [mux chain]; `casez` with `?` [renders, no crash]; tri-state `1'bz` [constant pill `1'bz`]; `{cout, sum} = a + b` [join on the adder output]; `assign y8 = a4 + b4` [adder output width 8]; `generate for` with 4 instances [4 boxes]; memory `reg [7:0] mem [0:15]` [generic `$mem` box, logged once]; a `function` in an `assign` [inlined logic].

A3 layout: crossing without a dot versus junction with a dot; 30-character names [boxes grow]; 50+ gates and one clock to 20 flops [readable, no hairball]; feedback loops readable; light, dark, high contrast, VS Code zoom, narrow sidebar, external monitor.

A4 interaction: hover and click on a multi-line expression; cursor highlight on every element kind; three-level hierarchy drill and breadcrumb; exported SVG in a browser and sharp PNG; sidebar and pop-out panel in sync.

A5 lifecycle: sleep then switch tabs; second window; five tabs quickly; split editors [the active editor is drawn]; rename and delete an open file; untitled set to Verilog; `rtlLive.synthesisBackend` = `wasm` [same diagrams as native]; only one VS Code version running.

A6 performance: 500-line design [typing instant]; one hour of use [helper process memory stable in Activity Monitor].

### Deferred to v0.3

- Part B: minimap, hover focus mode, print-ready export (white background option), designed loading and error states beyond the banner and badges, grid-snapped routing, monospace signal names and the full line-weight pass, selection accent on connected nets, a bubble on negative-latch clock pins.
- ACCURACY 6.4 golden screenshots compared on every change, and the contact sheet.
- A2 badges for undriven outputs, unused inputs and inferred latches from incomplete `case` (the latch itself is badged).
- A1 and A3 to A6 automation listed under "Manual checks".
- Structural view L1: logic clouds have no netlist; an RTL-view-from-structure for broken files.
- Part C: search, trace drivers and loads, cones, path view, stats, simulation values.
- Yosys front-end folding of `state == 1'b1` (fsm_moore keeps no comparator).

### Phase 7: package and report (done 2026-10-22)

- Version 0.2.0 (`85f5a27`), CHANGELOG and README updated (views, badges, error messages, settings, test commands).
- `npm run package`: `rtl-live-0.2.0.vsix`, 21 files, 17.43 MB. `npm run test:packaged`: 17 passing against the unzipped vsix.
- Installed with `"$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension rtl-live-0.2.0.vsix --force`; `--list-extensions --show-versions` prints `vejaysuriyaa.rtl-live@0.2.0` (the 0.1.0 folder stays under `~/.vscode/extensions` until VS Code cleans it up). Running windows need "Developer: Reload Window".
- Screenshots: `npm run test:webview` wrote the Phase 7 set to `artifacts/` (m1 to m7 PNGs, three themes for 7458, counter4, module_add and vector2, the stale overlay, the latch versus flop pair, the loop badge). No golden screenshot comparison yet (deferred).

### Final checklist

1. Full suite: typecheck and lint clean; unit and golden and accuracy 570 passing (25 files); integration 17 passing; webview 53 passing; packaged 17 passing.
2. `git status` clean. `git log --oneline` shows the phase commits from `fecd4d6` (Phase 1) to `85f5a27` (Phase 7). `git remote -v` lists `origin` as it was found; nothing was pushed.
3. Hygiene check: a search for AI tool names in tracked files returns nothing.
4. `git status` shows no changes under `test/fixtures/` after a full test run (the nine 5.2 fixtures and the two semantics fixtures were added, no existing fixture changed; the expected JSON files were edited only for the mechanical `simplified` to `rtl` rename and the fsm_moore per-view split).
5. docs/ACCURACY_REPORT.md: structural L1 4/43 (clouds have no netlist, deferred), L2 43/43, L3 43/43; rtl L1 43/43, L2 43/43, L3 43/43; gate L1 43/43, L2 5/5 asserted (n/a where the gate view is not asserted separately), L3 43/43.
6. Every bug in docs/BUGS.md is fixed with a commit in the Phase 3 table above (1 to 12 and the known issues 5 to 8).
7. vsix 0.2.0 built, installed, verified with `--list-extensions --show-versions`.

#### Phase 3 log (as it happened)

Done and committed:

- L1 first: logical operators (`9604f48`, bug 5). Gate view L1 is 34/34.
- Bug 4 and 11 (`86d1103`): `src/extension/lifecycle.ts` runs a ready watchdog (8 s, retry once, then a failure page with a Reload Window command link and button), a 15 s ping/pong heartbeat while visible (a missed pong reloads the page), and a resync on view show and window focus; the controller re-reads the active editor at those moments. Fake-timer unit tests plus three integration tests (`m7.lifecycle.test.ts`).
- Bug 2 and 6 (`fa4d083`): one rule. When the newest text does not parse or has not been synthesized, the last good diagram stays with the "Stale" badge and the ports that were added, removed or changed in the structural parse are overlaid muted (`src/ir/overlay.ts`); the badge text names the changes. Bug 9: untitled Verilog or SystemVerilog renders; untitled Plain Text that looks like Verilog gets a hint with "Set language to Verilog".
- Bug 3 (`bbc3cdd`): `src/structural/errorMessages.ts` names what is missing with the right line and column, including at the end of the file; tree-sitter MISSING tokens kept; recovered ports marked `tentative` and drawn greyed; Verilator (`lintWithVerilator`, now default on) sharpens generic messages 400 ms later. Integration test `m8.editing.test.ts` edits a temp copy of 7458.v four ways.
- Found while writing those tests (`8567cf3`): host-to-webview generations were per document, so after many edits in one file a freshly opened file was silently dropped by the page. Messages now carry a global sequence number; regression test "after many edits in one file, a freshly opened file still reaches the view". This is the ACCURACY.md 5.3 "switch tab" case.
- Bug 12: Phase 1.

Suite at the pause: typecheck and lint clean; unit 375 (21 files); integration 15; webview 49; `git status` clean under `test/fixtures/`.

The spec documents arrived during this phase (`fd5eca0`). Items that were PARTIAL for lack of them, now mapped:

| Item                                                                                                                                     | Where it goes                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bug 1 (module title overflows its box, Fit above 100%)                                                                                   | Phase 3, next: structural module box grows to its title (`nodeSize`/`moduleToElk` for the port-only case), `FIT_MAX_SCALE` to 1 (also closes every L3 "fit" failure)                                                                                                                                                                                                                                                       |
| Bug 7 (`{5{a,b,c,d,e}}` expands to one wire per bit)                                                                                     | Phase 3: periodic run detection in `fromYosys` `joinFor` (inner join of the group, outer pin `x5`), exporter already handles `{N{...}}` of any width                                                                                                                                                                                                                                                                       |
| Bug 8 (bus label touches the port chevron)                                                                                               | Phase 3 (or 5): place the width label on the longest segment of the first edge, L3 overlap check against port shapes                                                                                                                                                                                                                                                                                                       |
| Bug 10 (ports scattered in a grid when the file has errors)                                                                              | Phase 3: `elk.separateConnectedComponents=false` plus model order for port-only graphs; unit check that inputs are on the left, outputs on the right, in declaration order                                                                                                                                                                                                                                                 |
| ACCURACY 5.2 fixtures (rca4, mux4_case, en_flop, scan_flop, latch_vs_flop, counter8_reset, compare4, bitwise_vs_logical, inverted_gates) | Phase 2 backfill, done first thing in Phase 4 with expectations written to the "Must show" lines (existing case_mux, dff_enable, latch_en, logic_ops, nand_nor stay as variants)                                                                                                                                                                                                                                           |
| ACCURACY 5.1 "must show" rows for existing fixtures                                                                                      | Phase 4: add missing assertions (counter4 adder feedback, module_shift8 mux labels 0..3, fsm_moore comparator kept)                                                                                                                                                                                                                                                                                                        |
| ACCURACY 5.3 editing cases                                                                                                               | `module top_module(` title fits (bug 1 test), `module top_module(input a, output b` ports left/right (bug 10 test), delete endmodule (done), switch tab (done), sleep (manual, A5)                                                                                                                                                                                                                                         |
| ACCURACY 2 and 3 (RTL view and gate view)                                                                                                | Phase 4: two Yosys scripts (RTL: `proc; opt_clean; opt_dff; opt_clean`, no `opt_expr` so `state == B` stays a comparator; gate: current script), `$pmux` plus `$eq` on one selector collapsed to an N:1 mux with select-value labels, EN flop in RTL view, mux-in-front-of-D in gate view, toolbar toggle, badge shows the view, `synth.rtl` and `synth.gate` blocks in expected JSON, accuracy report gains an `rtl` view |
| ACCURACY 6.4 golden screenshots                                                                                                          | Phase 5: Playwright `toHaveScreenshot` baselines per fixture, light and dark, committed                                                                                                                                                                                                                                                                                                                                    |
| BUG_HUNT Part A                                                                                                                          | Phase 6: A1 and A2 as parser, IR and integration tests with new fixtures; A2 semantics (multiple drivers, undriven, unused, loop, latch, blocking vs non-blocking) as visible warning badges; A3 to A6 where feasible, rest in "Manual checks"                                                                                                                                                                             |
| BUG_HUNT Part B                                                                                                                          | Phase 5                                                                                                                                                                                                                                                                                                                                                                                                                    |
| BUG_HUNT Part C                                                                                                                          | out of scope except search and trace as a stretch                                                                                                                                                                                                                                                                                                                                                                          |

Exact next step: bug 1. Add a unit test that lays out `structuralToIr` of `module top_module(` and asserts the title text box fits the module frame and that `FIT_MAX_SCALE === 1`; then set the cap, size the frame to the title, and run `npm run test:accuracy:update` (the L3 "fit" entries disappear from `known-failures.json`; review the diff). Then bugs 10, 7, 8 in that order, each test first, then update docs/ACCURACY_REPORT.md and this section, and close Phase 3 with the full suite and `npm run test:packaged`.

## v0.3 work log (2026-10-22)

### Phase 0: baseline and triage

Baseline at `38c9bfa` (full suite, native Yosys): build, typecheck and lint clean; unit, golden and accuracy 570 passing (25 files); integration 17; webview 53; packaged 17. Accuracy report: structural L1 4/43, L2 43/43, L3 43/43; rtl L1 43/43, L2 43/43, L3 43/43; gate L1 43/43, L2 5/5 asserted, L3 43/43.

docs/BUGS.md items 13 to 18 were pasted by VJ at the start of the session and written into the tracked file. `.plan/RESEARCH.md` does not exist.

Triage of every BUGS.md item against the baseline build:

| Bug                                   | Status                                                                                                                                                                                                                                                                                                                                                                                                                                              | How checked                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1 title overflows, Fit above 100%     | fixed in v0.2.0 (test: `moduleFrame.test.ts` "grows to fit a long title", "never zooms past 100 percent")                                                                                                                                                                                                                                                                                                                                           | unit                             |
| 2 badge and drawing disagree          | fixed in v0.2.0 (test: `m8.editing.test.ts` "bug 2", `overlay.test.ts`)                                                                                                                                                                                                                                                                                                                                                                             | integration                      |
| 3 vague error messages, dropped ports | fixed in v0.2.0 (test: `errorMessages.test.ts`, `m8.editing.test.ts` "bug 3"); the dropped-port part regressed as bug 13                                                                                                                                                                                                                                                                                                                            | integration                      |
| 4 sidebar stuck after sleep           | fixed in v0.2.0 (test: `lifecycle.test.ts`, `m7.lifecycle.test.ts` "hiding and showing the view resyncs")                                                                                                                                                                                                                                                                                                                                           | integration                      |
| 5 logical vs bitwise                  | fixed in v0.2.0 (test: `synth.test.ts` logical rows, `bitwise_vs_logical` fixture L2); glyph readability is bug 17                                                                                                                                                                                                                                                                                                                                  | accuracy                         |
| 6 structural overlay on stale         | fixed in v0.2.0 (test: `overlay.test.ts`, `m7.states.spec.ts` ghost overlay)                                                                                                                                                                                                                                                                                                                                                                        | webview                          |
| 7 replicated groups                   | fixed in v0.2.0 (test: `synth.test.ts` "bug 7")                                                                                                                                                                                                                                                                                                                                                                                                     | unit                             |
| 8 bus label on the chevron            | fixed in v0.2.0 (test: accuracy L3 `noOverlap` 2b on every fixture)                                                                                                                                                                                                                                                                                                                                                                                 | accuracy                         |
| 9 untitled files                      | fixed in v0.2.0 (test: `m8.editing.test.ts` "bug 9")                                                                                                                                                                                                                                                                                                                                                                                                | integration                      |
| 10 ports in a grid                    | fixed in v0.2.0 (test: `portPlacement.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                     | unit                             |
| 11 blank webview in a new window      | fixed in v0.2.0 (test: `m7.lifecycle.test.ts` "a page that never posts ready")                                                                                                                                                                                                                                                                                                                                                                      | integration                      |
| 12 tests share the real profile       | fixed in v0.2.0 (test: `isolation.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                         | unit                             |
| 13 port vanishes during recovery      | still reproduces: `input p1a, p1b, p1c p1d p1e, p1f,` parses to p1a p1b p1d p1f ... p1e (tentative); p1c is gone and the w2 cloud reads only p1a and p1b. Fixture `test/fixtures/partial/p9_two_missing_commas.v`                                                                                                                                                                                                                                   | scratch parse of the fixture     |
| 14 crowded fan-out                    | still reproduces: in vectorgates (rtl view) the nearest parallel segments of different nets (`a`, `b` trunks) are 6 px apart; junction dots are r 2.5 on a 3 px bus stroke                                                                                                                                                                                                                                                                          | scratch layout metrics           |
| 15 join labels cramped                | still reproduces: `[5:3]` and `[2:0]` on the out_not join are 8.5 px text 12 px apart (3 px gap), no own label space                                                                                                                                                                                                                                                                                                                                | scratch layout metrics           |
| 16 dashed yellow segment              | still reproduces with the HDLBits solution form `assign out_not[5:3] = ~b; assign out_not[2:0] = ~a;`: `multiplyDrivenSignals` counts names, so disjoint slices of one vector get the "multiple drivers" badge (the dashed warning style) and an error in the banner. The tracked `vectorgates.v` uses one concatenation assign and shows nothing. New fixture `test/fixtures/hdlbits/vectorgates_slices.v` (expected JSON copied from vectorgates) | scratch synth of the new fixture |
| 17 logical OR glyph                   | still reproduces by design: `                                                                                                                                                                                                                                                                                                                                                                                                                       |                                  | `glyph inside an OR gate, tooltip says`logical: 1` | scratch render titles |
| 18 explanations for every symbol      | still reproduces: tooltips exist on nets, ports and nodes but read as data (`op: not`, `width: 3`); none on junctions, crossings, bubbles, slashes; no legend                                                                                                                                                                                                                                                                                       | scratch render titles            |

The new vectorgates_slices fixture also fails structural L3 (the cloud for two slice assigns to `out_not` is sized for one line and shows the second assign's text; `out_not` has no width label) and rtl and gate L3 (the false warning badge sits on the `[5:3]` ripper label). All four are in `known-failures.json` for Phase 1 to clear.

Gate: triage table above; fixtures `p9_two_missing_commas.v`, `vectorgates_slices.v` with expected JSON committed.

### Phase 1: correctness and misleading markers

- Bug 16 (`src/ir/semantics.ts`, `src/structural/lvalues.ts`): the dashed yellow segment was the "multiple drivers" badge, raised because the driver count was per signal name. Driver analysis is now bit-accurate: every assign and every always block is one driver, its left-hand sides are parsed into literal bit ranges (`y[5:3]`, `q[0]`, `x[4 +: 2]`, concatenations), and only bits written by two drivers are reported. The message names the bits (`y[3:2] has multiple drivers`, `y bits [6:5], [0] has multiple drivers`), the wire tooltip reads `warning: multiple drivers on y[3:2]`, and whole-signal clashes keep the old wording. `SAlways.lhsTexts` carries the left-hand sides of always-block assignments. The structural view draws two or more disjoint slice assigns as one cloud per assign feeding a join (pins labelled with the ranges), so `assign out_not[5:3] = ~b; assign out_not[2:0] = ~a;` looks like the RTL view instead of two clouds with the same id. Tests: `test/unit/drivers.test.ts` (both parsers).
- Bug 13 (`src/structural/treeSitterParser.ts`): a missing comma makes tree-sitter read `p1c p1d` as a port of user type `p1c` named `p1d`, which is why `p1c` vanished; with two missing commas the second name landed in an ERROR node and was recovered out of order. An identifier in the type position that is not a `typedef` of the file is now a tentative port, reported as `missing ',' before 'p1d'`, and recovered ports are sorted back into text order. A port named by a keyword (`p1f output p1y` with the comma gone) is dropped instead of becoming a port called `output`. Tests: `test/unit/portRecovery.test.ts`: the p9 fixture keeps all twelve ports in order with p1c, p1d and p1e tentative and the w2 cloud reading p1c; the typing fuzz deletes every character of the 7458 port list in turn and checks that every name still written as a whole token is still a port.
- Accuracy: the vectorgates_slices L3 entries left the baseline (no false badge, one cloud per assign); structural L1 stays at clouds only.

### Phase 2: readable layout and spacing (bugs 8, 14, 15)

New L3 checks in `test/accuracy/layout.ts`, run on every fixture in all three views and fed known-bad input in `harness.test.ts`: `wireSpacing` (parallel segments of different nets at least 8 px apart), `labelsClear` (bus width labels, ripper labels and warning badges never on a wire of another net; ripper labels carry `data-net`), `junctions` (every dot is a real T of its own net, no dot on a crossing, no 4-way, two dots never touch, radius at least 2.5 times the stroke). Before the fixes they failed on 41, 27 and 12 fixture views.

A/B of the ELK spacing over all 44 fixtures in three views (132 layouts), measured on the rounded layout: crossings between nets, parallel pairs of different nets under 8 px, and total drawing area. Ripper pins were already at a 16 px pitch for this run.

| set       | edgeEdge | edgeEdgeBetweenLayers | edgeNodeBetweenLayers | nodeNodeBetweenLayers | crossings | pairs under 8 px | min gap | area      |
| --------- | -------- | --------------------- | --------------------- | --------------------- | --------- | ---------------- | ------- | --------- |
| A (v0.2)  | 10       | 10                    | 20                    | 44                    | 305       | 20               | 4       | 11.5M px2 |
| B (brief) | 12       | 12                    | 20                    | 56                    | 301       | 22               | 3       | 12.4M     |
| C         | 12       | 12                    | 24                    | 56                    | 303       | 25               | 3       | 13.0M     |
| D         | 16       | 16                    | 28                    | 64                    | 307       | 2                | 6       | 13.9M     |
| E         | 14       | 14                    | 24                    | 64                    | 309       | 7                | 7       | 13.1M     |
| F         | 16       | 16                    | 24                    | 56                    | 309       | 4                | 5       | 12.7M     |
| G         | 20       | 20                    | 28                    | 64                    | 307       | 6                | 5       | 14.1M     |

Set D was chosen (20 percent more area than v0.2, 2 close pairs left). A second A/B of the node placement strategy with set D: network simplex 307 crossings and 2 close pairs; Brandes-Koepf 259 crossings, 0 close pairs, min gap 11 px, area +4 percent; Brandes-Koepf balanced 295 and 15; linear segments 275 and 0. Brandes-Koepf is now the default (`webview/layout/toElk.ts`).

Other changes:

- Junction dots are 2.5 times the stroke (r 3 on 1-bit wires, r 6 on buses, `junctionRadius` in geometry.ts, checked against styles.css). `webview/layout/postprocess.ts` slides one branch of every 4-way junction along its trunk by 8 px (14 px on buses) into a second T, keeping 8 px from other nets, and rebuilds the dot list from the geometry so every T has a dot and no dot sits on a plain crossing. The renderer and the L3 checks share `prepareLayout` (round, then separate).
- Join input labels sit left of the bar above their own incoming slice, split output labels right of the bar above their own outgoing slice, at a 16 px pin pitch (`RIPPER_PITCH`). The label room is declared to ELK as port labels (`elk.portLabels.placement: OUTSIDE`), which the layered router keeps clear of; `elk.margins` turned out to be ignored by the router.
- Bus width labels and warning badges try several spots along the wire and take the first one clear of other nets' wires, symbols and the net's own junction dots (`busLabelPos` in svg.ts).
- Screenshots: `artifacts/v03-layout/<fixture>-before.png` and `-after.png` for vectorgates, 7458, module_add and module_shift8 (`test/webview/m8.layout.spec.ts`, tag through `RTL_LIVE_SHOT_TAG`).

Result: L3 passes on every fixture in all three views, including the four new checks.

### Phase 3: beginner-friendly clarity (bugs 17, 18)

- Bug 17 (`webview/render/logical.ts`): logical operators are drawn the way they work. A `||` or `&&` with bus inputs gets one "any 1?" box per bus input (an OR of all bits, 1-bit output) in front of a plain 1-bit gate; `!` on a bus is one "all 0?" box; 1-bit inputs keep the plain gate. The gate keeps its `||`, `&&` or `!` glyph and carries a small "logical" tag in a strip under the body. This is a presentation transform applied in `moduleToElk` and `renderModule` (and in the L3 checks), so the IR, the Verilog export, L1 and the expected JSON files are unchanged.
- Bug 18 (`webview/render/tooltips.ts`): every element carries a one-sentence plain tooltip from the table in the brief, followed by `from line N: <source line>` when the host sends the text (`sourceLines` on the render message, split from the text that produced the diagram). Nets say "N separate wires drawn as one line (a bus)" or "One wire, 1 bit" plus clock, reset and warning sentences; ports say which way they are driven; junction dots say "Wires connect here"; plain crossings get an invisible hit circle that says the wires do not connect; inversion bubbles, the clock triangle, labelled pins (D, Q, EN, R, S, mux inputs), the bus slash, ripper labels and warning badges all explain themselves. Gates, reduce boxes, muxes, flip-flops, latches, constants, instances, black boxes, clouds and arithmetic boxes get the sentences from the table.
- Legend: a "Legend" toolbar button (key `l`, Escape closes) opens a panel listing every symbol, drawn with the same symbol code (`webview/ui/legend.ts`, DOM in `chrome.ts`), theme aware. A unit test checks that the items cover every `NodeKind` plus ports, wires, buses, junctions, crossings and warnings.
- Wording pass: status line reads "ready, from cache", "synthesizing (turning the code into gates)", "synthesized in N ms", "showing the last good diagram; fix the error to update it", "too big to draw as gates (over 2,000 cells); showing the code outline"; badges carry a tooltip that says what the state means; toolbar buttons say what they do in plain words. The `.tb-btn` stylesheet rule lost in v0.2 is restored and the node hover rule is no longer tied to the ghost rule.
- Tests: `test/unit/tooltips.test.ts` (every node, port, net, junction, crossing, bubble, slash and clock triangle in every golden has a sentence; source line quoting; the symbol table; the logical expansion on vectorgates, logic_ops and bitwise_vs_logical), `test/unit/legend.test.ts`, Playwright `m9.legend.spec.ts` (legend panel in light and dark with screenshots `artifacts/m9-legend-<theme>.png`, boxes, tag and tooltips in the real bundle).

### Phase 4: selected deferred items

- Focus mode (`webview/interaction/focus.ts`): hovering a wire lights its whole net (every segment and dot) and the symbols at its ends; hovering a symbol or port lights every net on its pins; everything else dims (opacity 0.18 for wires, 0.3 for symbols, a 120 ms transition that reduced-motion turns off); Escape or leaving the diagram clears it. Pure helpers `focusNets` and `focusSymbols` are unit tested on the 7458 golden; Playwright `m10.states.spec.ts` checks the classes and the computed opacity.
- Designed states, each one sentence and at most one button: empty ("Open a Verilog file (.v or .sv) to see its schematic."), no module ("No module found yet. Start with: ..."), loading ("Starting Yosys, the synthesizer. The first diagram takes a moment." while warming up, "Synthesizing: turning the code into gates." while the first synthesis runs), error (the banner sentence plus one "Go to line N" button that reveals the line), stale ("Showing the last good diagram." in front of the error, badge "Stale" with its tooltip). A global `[hidden] { display: none !important }` rule keeps flex containers hidden.
- Contact sheet: `npm run test:webview` writes `artifacts/contact-sheet.html` and `artifacts/contact-sheet.png`, every golden fixture drawn small in a grid (light theme), for a quick visual review after any renderer change.

### Deferred to v0.4

- Minimap, print-ready export (white background option), grid-snapped routing, monospace signal names and the full line-weight pass, selection accent on connected nets beyond focus mode, a bubble on negative-latch clock pins.
- Golden screenshot comparison on every change (the contact sheet is reviewed by eye).
- A2 badges for undriven outputs, unused inputs and inferred latches from incomplete `case`.
- A1 and A3 to A6 automation listed under "Manual checks" in the v0.2 log.
- Structural view L1: logic clouds have no netlist.
- Part C: search, trace drivers and loads, cones, path view, stats, simulation values.
- Yosys front-end folding of `state == 1'b1` (fsm_moore keeps no comparator).
- Source lines in tooltips come from the newest text, so line numbers can drift by a line or two while a stale diagram is shown.

### Phase 5: package and report (done 2026-10-22)

- Version 0.3.0 (`ffc06ab`), CHANGELOG entry, README (logical boxes, tooltips, legend, focus mode, layout rules, new screenshots under `media/screenshots/`: `7458.png`, `module_add.png`, `vectorgates-logical.png`, `legend-dark.png`, `focus-mode.png`, `contact-sheet.png`).
- `npm run package`: `rtl-live-0.3.0.vsix`, 21 files, 17.44 MB. `npm run test:packaged`: 17 passing against the unzipped vsix.
- Installed with `"$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension rtl-live-0.3.0.vsix --force`; `--list-extensions --show-versions` prints `vejaysuriyaa.rtl-live@0.3.0`. Running windows need "Developer: Reload Window".

### v0.3 summary

| Phase         | What                                                                                                                           | Commits                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| 0 triage      | baseline, bugs 13 to 18 reproduced, fixtures `p9_two_missing_commas.v`, `vectorgates_slices.v`                                 | `b839563`                       |
| 1 correctness | bit-accurate drivers and a join for slice assigns (16); swallowed port names recovered (13)                                    | `94665b2`, `77c2b82`            |
| 2 layout      | four new L3 checks; spacing A/B (set D) and Brandes-Koepf; T-only junctions; labels on their own wires; before and after shots | `7af30e4`, `b677bba`, `4ff290a` |
| 3 clarity     | logical operators as any-1 boxes (17); tooltips on everything with the source line, legend, wording (18)                       | `53f576a`, `0a00f7e`, `ef11e57` |
| 4 deferred    | focus mode, designed states, contact sheet                                                                                     | `9e28cd3`, `a11c0ab`            |
| 5 release     | 0.3.0, package, install                                                                                                        | `ffc06ab`                       |

Final status of every docs/BUGS.md item:

| Bug                              | Final status                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1 to 12                          | fixed in v0.2.0, regression tests confirmed in the Phase 0 triage table                                                   |
| 13 port vanishes during recovery | fixed `77c2b82` (test: `portRecovery.test.ts`, including the typing fuzz)                                                 |
| 14 crowded fan-out               | fixed `b677bba` (test: accuracy L3 `wireSpacing` and `junctions` on every fixture; `postprocess.test.ts`)                 |
| 15 join labels cramped           | fixed `b677bba` (test: accuracy L3 `labelsClear` and `noOverlap`)                                                         |
| 16 dashed yellow segment         | fixed `94665b2` (test: `drivers.test.ts`; the dashed style is the multiple-driver warning and its tooltip names the bits) |
| 17 logical OR glyph              | fixed `53f576a` (test: `tooltips.test.ts` "logical operators drawn as reduce boxes", `m9.legend.spec.ts`)                 |
| 18 explanations for every symbol | fixed `0a00f7e`, `ef11e57` (test: `tooltips.test.ts`, `legend.test.ts`, `m9.legend.spec.ts`)                              |
| 5 to 8 known issues              | fixed in v0.2.0; 8 re-checked by the v0.3 label placement (`b677bba`)                                                     |

Layout A/B numbers: see Phase 2 above (set D plus Brandes-Koepf: 259 crossings over 132 layouts, no parallel wires of different nets under 8 px, min gap 11 px, area 14.8M px2 against 11.5M in v0.2).

Test counts at the end: unit, golden and accuracy 604 passing (31 files); integration 17; webview 63; packaged 17. Accuracy report: structural L1 4/44 (clouds have no netlist), L2 44/44, L3 44/44; rtl L1 44/44, L2 44/44, L3 44/44; gate L1 44/44, L2 5/5 asserted, L3 44/44.

Remaining known issues: tooltip source lines come from the newest text while a stale diagram is shown, so a line number can drift by a line or two; junction dots on buses are 12 px wide by the Part B rule, which reads heavy on dense fan-outs; Yosys folds `state == 1'b1` before any pass (fsm_moore keeps no comparator). The deferred list is under "Deferred to v0.4" above.

### Final checklist (v0.3)

1. Full suite green on the native Yosys backend: typecheck and lint clean; unit, golden and accuracy 604 passing (31 files); integration 17; webview 63; packaged 17. The unit, golden and accuracy suites also pass on the wasm backend (`RTL_LIVE_TEST_BACKEND=wasm npx vitest run`, 604 passing).
2. `git status` clean. `git log --oneline` shows the phase commits from `b839563` (Phase 0) to `ffc06ab` (Phase 5). `git remote -v` lists `origin` as it was found; nothing was pushed.
3. Hygiene check passed: the search of tracked files returns nothing.
4. No existing file under `test/fixtures/` changed; three files were added (`hdlbits/vectorgates_slices.v`, `expected/vectorgates_slices.json`, `partial/p9_two_missing_commas.v`).
5. docs/ACCURACY_REPORT.md: structural L1 4/44 (clouds have no netlist, deferred), L2 44/44, L3 44/44; rtl L1 44/44, L2 44/44, L3 44/44; gate L1 44/44, L2 5/5 asserted, L3 44/44, with the four new L3 checks.
6. Every docs/BUGS.md item is fixed with a commit hash in the v0.3 summary table above.
7. vsix 0.3.0 built, installed into `~/Applications/Visual Studio Code.app` with its bundled CLI, verified with `--list-extensions --show-versions`.

## v0.3.1 work log (2026-10-23)

Scope: docs/BUGS.md items 19 and 20. Baseline at `21e9e52`: unit, golden and accuracy 604 passing (31 files); integration 17; webview 63; packaged 17.

### Bug 19: crowded fan-out hub (fixed `9bfb574`)

- Tests first: `harness.test.ts` feeds the checker two T junctions 12 px apart and a crossing 10 px from a dot; `postprocess.test.ts` asks the post-pass to slide a dot clear of a crossing and clear of another net's dot, and to leave a fenced-in dot alone.
- Checker blind spot: `junctionDots` matched a net group up to the first `</g>`, and bus groups hold a nested slash-and-width group before the dots, so dots on bus wires were never measured (vectorgates reported none). It now walks group depth. New L3 checks `junctionSpacing` (dots at least 20 px apart, any nets) and `crossingClearance` (plain crossings at least 16 px from any dot) run on every fixture in all three views. With the parser fixed and the checks added, 20 fixture views failed: arith_compare, compare4, inverted_gates and vectorgates in all three views, mux2_always, nand_nor, vectorgates_slices and xnor_misc in rtl and gate.
- Root causes in vectorgates (raw ELK output): both `b` branches left the trunk at x=127 (a 4-way the old pass could not split, because it required the trunk to run two offsets past the move), and OR gate inputs sat 11.7 px apart (`rows * 12 + 10` spread evenly by ELK), so the crossing of `a`'s vertical with `b`'s wire into the same gate was always one pin pitch, 12 px, from `a`'s dot. The 14 px and 15 px cases on arith and mux boxes were the same thing: ELK spread pins evenly over the node height, so the pitch was h/(rows+1), never 16.
- Fix: node pins are ELK `FIXED_POS` ports in IR order at exactly PIN_PITCH (16 px), centred in the pin band (title rows excluded); gate height is `(inputs - 1) * 16 + 14`, so two inputs still fit the 30 px symbol and three take 46 px as before. `junctionOffset` is at least `MIN_DOT_GAP` (20) and the 4-way split only needs an 8 px trunk margin beyond the moved dot. A new spread phase in `separateJunctions` slides any dot closer than 20 px to another dot or 16 px to a crossing along its trunk (4 to 32 px, nearest first), accepting a move only when the moved leg keeps 8 px from other nets, the dot is still a T, it is clear itself, and the drawing is less crowded than before; dots nothing can fix are left and reported by the checker.
- After the fix: 0 failures, every fixture view passes all ten L3 checks. Changed expectations: the post-pass offset tests asked for 8 and 14 px between the two dots of a split 4-way and now assert 20; the toElk port test asserted FIXED_ORDER and now asserts fixed positions one pitch apart.

### Bug 20: legend labels (fixed `87afe2b`)

- Cause: `svg.schematic { width: 100%; height: 100% }` applied to the legend samples too, so a 32 px wide join sample was scaled three times into the 96 px column, and its ripper labels (drawn outside the sample's viewBox) spilled into the text column (split) or were clipped by the panel edge (join, showing `:0]`).
- Fix: `sample()` adds the room the range labels need beside a ripper bar to the sample box; the panel's svg viewBox is as wide as the picture column (`LEGEND_PIC_W` = 120, matched by `.legend-pic` in the stylesheet) so one unit is one pixel, with the sample centred; the panel is 320 px wide.
- Tests: `legend.test.ts` measures every sample's text boxes (inside the sample, no two overlapping, sample narrower than the column) and checks the stylesheet width against the constant. `m9.legend.spec.ts` measures the rendered panel in light and dark: svg scale exactly 1, every label inside the picture column and clear of the text column, ripper labels at the diagram's font size; writes `artifacts/m9-legend-panel-{light,dark}.png` and `m9-legend-{join,split}-{light,dark}.png`.

### Release

- `c00542e`: version 0.3.1, CHANGELOG, README (pin pitch and dot rules), screenshots regenerated once (`7458.png`, `module_add.png`, `vectorgates-logical.png`, `legend-dark.png`, `focus-mode.png`, `contact-sheet.png`).
- `npm run package`: `rtl-live-0.3.1.vsix`, 21 files, 17.44 MB. `npm run test:packaged`: 17 passing. Installed with the bundled CLI of `~/Applications/Visual Studio Code.app`; `--list-extensions --show-versions` prints `vejaysuriyaa.rtl-live@0.3.1`. Running windows need "Developer: Reload Window".
- Test counts: unit, golden and accuracy 612 passing (31 files); integration 17; webview 65; packaged 17. Accuracy report unchanged in pass counts (structural L1 4/44, everything else 44/44 or 5/5 asserted) with the two new L3 checks.
- Hygiene check passed. No file under `test/fixtures/` changed. Nothing pushed.

| Bug                    | Final status                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19 crowded fan-out hub | fixed `9bfb574` (test: accuracy L3 `junctionSpacing` and `crossingClearance` on every fixture and view; `harness.test.ts`; `postprocess.test.ts`; `toElk.test.ts` pin pitch) |
| 20 legend labels       | fixed `87afe2b` (test: `legend.test.ts` sample layout; `m9.legend.spec.ts` rendered scale and overlap, light and dark)                                                       |

Known issue: `docs/BUGS.md` items 13 to 18 were only in this log until `7299f8f`; the tracked list now carries 1 to 20.

## v0.4 work log (2026-10-23)

Scope: the v0.4 brief, a premium visual design pass. Baseline at `a5bb707` (v0.3.1 plus the Stryker mutation-testing setup): unit, golden and accuracy 617 passing; integration 17; webview 65; packaged 17.

### References

Studied for look only, no code copied (THIRD_PARTY_NOTICES.md records this): netlistsvg (MIT) for hand-drawn symbol skins and muted wires, DigitalJS (BSD-2-Clause) for rounded orthogonal wires and port dots, d3-hwschematic (MIT) for hierarchy expand and net highlight, HDElk (MIT) for the calm single-accent palette and label placement. The one asset taken in is the codicon font (`@vscode/codicons`, CC-BY-4.0) for the toolbar, credited in the notices.

### Tokens (`webview/render/tokens.ts`)

- One source of truth: `STROKE` (wire 1.25, bus 2.5, symbol 1.75, frame 1, detail 1.25, high contrast 2), `RADIUS` (node 6, port 4, bend 4, bend guard 8), `FILL_PERCENT` (body 6, frame 3, dashed 0, port 12), `OPACITY` (wire 0.7, faded 0.35), `FONT_PX` (label 11, title 12, small 10, tag 8), `JUNCTION_FACTOR` 2.5, `GLOW_PX` 2, `MOTION_MS` 150, `EXPORT_MARGIN` 24, and `CSS_TOKENS`, the same values as the `--rl-*` custom properties.
- `webview/styles.css` repeats them on `:root` (a stylesheet cannot import a module). `test/unit/tokens.test.ts` parses the `:root` block and fails when any token differs, checks that every `stroke-width` outside `:root` is a `var(--rl-stroke-*)`, and that `geometry.ts` draws wires and dots from the same numbers. `harness.test.ts` resolves the wire strokes through the token the stylesheet names instead of a literal.
- Colours: `--rl-accent` is the theme link colour (`--vscode-textLink-foreground`, falling back to charts blue); wires are `color-mix(fg 70%, bg)`; fills are `color-mix(fg 6%, bg)` and `color-mix(fg 3%, bg)`; high contrast themes override the tokens on `body[data-theme]` (no fills, no glow, no shadows, 2 px borders, `--vscode-contrastActiveBorder` as the accent, `--vscode-contrastBorder` for lines).
- Type: `--rl-mono` is the editor font (`--vscode-editor-font-family`) with a monospace fallback stack; labels, pin labels, widths and slice ranges use it; module titles, box titles, operator glyphs and tags use the UI font. `CHAR_W` is `11 * 0.6` (unchanged in value), `RIPPER_LABEL_CHAR` and the bus width char are `10 * 0.6`.

### Shapes

- Wire bends: `edgePath(e, guards)` puts a quadratic arc of radius 4 at every bend, shrunk on short segments so two arcs never meet, and keeps a bend sharp within 8 px of a junction dot of the net or of either end of the wire (a pin or a port), so a rounded corner can never read as a connection. The guards are every junction dot of the net across all its wires, because the T of one wire is a bend of the branch wire. `test/unit/shapes.test.ts`.
- `roundedPolygonPath(points, r)` rounds every corner of a closed polygon; port chevrons use it with radius 4, the mux trapezoid with 3. Rectangular bodies use `rx` 6 (`RADIUS.node`); the constant pill and the cloud keep their own radii.
- Junction dots take the accent; pins, pin stubs and bus slashes take the wire colour; bubbles and the clock triangle keep the detail stroke.
- Hover: `filter: drop-shadow(0 0 2px accent)` on the hovered node, port or wire, no colour change; the editor cursor match takes the accent stroke plus the glow. Focus mode fades to `--rl-faded` (0.35). Transitions use `--rl-motion` and are off under `prefers-reduced-motion`.
- Static node shadow A/B (`artifacts/v04-ab/`): `drop-shadow(0 1px 1.5px rgba(0,0,0,0.28))` on every body measured 60 fps against 60 fps plain over 40 zoom steps in both themes, so cost was not the deciding factor; at the sidebar's size the shadow was barely visible in light and invisible in dark, and it adds a compositing layer per node. Decision: no static shadow.

### Toolbar, states, export

- Toolbar: 22 px controls, icon buttons 24 px square with codicons (screen-full, zoom-in, zoom-out, open-preview) and `aria-label`, RTL and Gate as one bordered segmented control (`role="group"`), groups 8 px apart. The codicon font is referenced from the stylesheet; esbuild's file loader copies it to `dist/codicon.ttf` (`assetNames: "[name]"`) so the webview's `font-src` covers it.
- Packaging catch: `.vscodeignore` is an allowlist, so the first `npm run test:packaged` showed `Webview.loadLocalResource - Error using fileReader ... dist/codicon.ttf` in the VS Code log (the icons would have fallen back to blank squares in the installed extension while every test in the dev tree passed). `m0.sidebar.test.ts` now asserts that the font the stylesheet references exists in the extension, which fails against the unpacked vsix until `!dist/codicon.ttf` is listed; the same guard pattern caught the 0.1.0 grammar bug.
- Badges, banner, hint, breadcrumb, Legend panel and the empty, loading, error and stale states use the same line, chip and shadow tokens.
- Export: `webview/render/exportDoc.ts` is a pure builder (unit tested): 24 px margin on every side, opaque background, the diagram stylesheet rules (the `:root` token block and the `.schematic` rules, nothing else) inlined, and the palette pinned after them so it wins. `PRINT_COLORS` is dark lines on white with safe font stacks; the theme palette resolves the live `--rl-*` values (they come back as the substituted text, for example `#1e1e1e`, not rgb) and appends fallbacks to the fonts. `rtlLive.exportPalette` (`print` default, `theme`) travels in a new `config` host message, replayed to late webviews like `theme`. PNG export reads its size from the SVG so the margin is included.

### Performance

- The render budget test (`test/unit/renderPerf.test.ts`, 100 gates with fan-out, 201 edges, 153 junction points) found `renderModule` taking 2261 ms, of which 1326 ms was `separateJunctions` and the rest its crowding bookkeeping: every slide attempt recomputed every junction dot and every crossing of the whole drawing (O(wires squared) per attempt, up to 1024 attempts).
- Fix in `webview/layout/postprocess.ts`, same acceptance rules, same results on every fixture (the post-pass and accuracy suites are unchanged): segments are indexed by the coordinate they run along (`SegIndex`, with range queries over sorted keys), dots and crossings live in counted point sets bucketed by cell (`PointSet`), crossings are kept per segment per net, which dots are crowded is cached and only re-evaluated near a change, and a slide attempt scores the change in the crowding count from what it touches (one or two dots and the crossings of three segments) instead of recounting. The 4-way phase builds its index only when a net has a 4-way. The renderer's crossing markers use the same index, and width labels check only the wires in the 64 px cells around them.
- Quiet-CPU numbers (mutation workers paused): `separateJunctions` 7.7 ms, `renderModule` 12.9 ms best of 10 for the 100-node view (from 2261 ms). The test (`test/perf/renderPerf.test.ts`, `npm run test:perf`) asserts the best of 40 runs under 16 ms and runs on its own: inside the full vitest run, eight worker processes share the cores and the same best of 40 measured 20 ms, so the budget is checked without that contention, the way `npm run bench` is. ELK itself for the same view takes 266 to 376 ms in node (it runs in a worker in the webview and was never inside a 16 ms budget; the brief's "layout plus render" is met for the render half, and ELK is unchanged).
- Zoom and scroll stay at 60 fps (the A/B measurement above).

### Proof

- `artifacts/v04-before/` (rendered at `a5bb707` before any change) and `artifacts/v04-after/`: `test/webview/v04.visual.spec.ts` with `RTL_LIVE_V04_DIR` writes a contact sheet of every fixture in light and dark, and vectorgates, 7458, module_add, module_shift8, counter4, fsm_moore and the Legend in light, dark and high contrast. `scripts/v04-compare.mjs` writes `compare-<name>-<theme>.png` pairs.
- Review rounds: (1) first tokens pass: wires, dots and type right; port labels bold mono readable; ripper bars now the darkest mark on the page, kept as symbols. (2) After shapes and toolbar: rounded bends visible and never near a dot; bus junction dots (radius 6.25) read heavy next to a 2.5 px bus but follow the v0.3 rule, kept; icon buttons sit flat in the toolbar like VS Code's own; dark theme dashed boxes and muted pin labels clear. (3) counter4 and module_shift8 dark, Legend in high contrast: nothing left to change; high contrast uses the focus border fallback for the accent in the harness and `contrastActiveBorder` in VS Code.
- `test/webview/v04.hover.spec.ts`: hover adds a drop-shadow and keeps the outline stroke and width; focus fades to 0.35; high contrast has no fills, 2 px outlines and a zero-radius glow; the export is print by default and theme after a `config` message.

### Release

- Commits: `970c11a` perf(layout) post-pass indexes and the render budget; `9726833` feat(webview) tokens, palette, shapes, type, toolbar, high contrast, the visual proof spec and the shipped-font guard; `b240255` feat(export) print palette, margin, fonts, `rtlLive.exportPalette`; `3b4861c` version 0.4.0, CHANGELOG, README, screenshots (`7458.png`, `module_add.png`, `before-after.png`, `vectorgates-logical.png`, `legend-dark.png`, `focus-mode.png`, `contact-sheet.png`), `scripts/v04-compare.mjs`.
- Gates on the final tree: unit, golden and accuracy 630 passing (35 files); `npm run test:perf` 1 passing (best of 40 under 16 ms with the mutation workers paused); integration 18 (the font guard is new); webview 92; packaged 18 against the vsix; typecheck and lint clean; hygiene check passed; no file under `test/fixtures/` changed; nothing pushed.
- `npm run package`: `rtl-live-0.4.0.vsix`, 22 files, 17.52 MB (the 22nd is `dist/codicon.ttf`). Installed with the bundled CLI of `~/Applications/Visual Studio Code.app`; `--list-extensions --show-versions` prints `vejaysuriyaa.rtl-live@0.4.0`. Running windows need "Developer: Reload Window".
- The Stryker run started before this work (`a5bb707`, 11350 mutants over the pre-v0.4 tree) kept running throughout; its workers were paused with SIGSTOP for the timing measurements and the full vitest gate, a few minutes in all, so a handful of in-flight mutants may be recorded as timeouts. Its report and triage are the next step, in their own section.

| Brief item   | Final status                                                                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 references | studied, no code reused, codicons credited                                                                                                                                                                                        |
| 2 tokens     | `tokens.ts` plus `:root`, test-enforced; strokes, colours, fills, corners, dots, type, hover, motion, high contrast as specified; static shadow A/B done, not adopted                                                             |
| 3 polish     | toolbar, badges, banner, hint, breadcrumb, states, Legend; export print palette with margin and fonts, theme as a setting                                                                                                         |
| 4 proof      | `artifacts/v04-before/`, `artifacts/v04-after/` with 14 compare images; three review rounds recorded above                                                                                                                        |
| 5 rules      | L1, L2, L3 all passing in every view (accuracy baseline unchanged); render budget held and tested; behaviour tests first for hover and export; screenshots in light, dark and high contrast; 0.4.0 packaged, tested and installed |

Next step: triage the mutation report when the run ends (`artifacts/mutation/mutation.json`; `node` the survivor summary by file), add tests for real gaps, record the score in NOTES.md.

## v0.4.1 work log (2026-10-23)

Scope: docs/BUGS.md items 21 to 23, recorded in `a6835a3` together with the learning mode idea for v0.5. Baseline at `41dee58`: unit, golden and accuracy 630 passing (35 files); integration 18; webview 92; packaged 18.

### Bug 21: ports-only module shows the no-file state (fixed `edfc823`)

- Reproduced with `test/fixtures/partial/p10_ports_only.v` (the vectorgates header and nothing else): the parse was clean, synthesis returned ok, and `doc.modules` was empty. Yosys writes `"blackbox": 1` on a module whose body is empty, and `fromYosys` skipped every module with that attribute, so the top never reached the webview; `emptyMessage` then fell through to "Open a Verilog file".
- Fix: the reader keeps every module named in the user's file whatever Yosys tags it (stubs from `blackboxStubs` are still skipped). Output and inout ports whose bits have no driver get `Port.undriven`; the structural pass sets the same flag from assigns, always blocks and instance connection identifiers, only on a module that parsed cleanly. `portNodeWidth` reserves `PORT_HINT_W` to the left of an undriven output, the chevron stays at the frame edge, and "not driven yet" is drawn there in the small muted italic type with a tooltip sentence that says what to add. The webview's empty state says "No diagram for <name> yet." whenever a doc is loaded; the no-file sentence is only for no doc.
- Tests first: `test/unit/portsOnly.test.ts` (synthesized rtl and gate docs keep the module with five ports and no nodes, outputs undriven, inputs not; structural view flags the same outputs and leaves a driven output plain; rendered markup puts inputs left of outputs with the hint and class on every undriven output and not on inputs; tooltip text), `m10.states.spec.ts` (a render whose module is missing shows "No diagram for top_module yet.", never the no-file sentence; a ports-only doc draws three hinted ports in light and dark, `artifacts/v041-ports-only-{light,dark}.png`). Golden files unchanged: no fixture has an undriven output.

### Bug 22: the less helpful error wins (fixed `249f830`)

- Cause: the statement pass in `describeSyntaxErrors` deliberately skipped a bare `assign` (`last === t && startsAssign`), so the only issue at that spot was "missing endmodule" (rank 3) at the end of the file.
- Fix: an assign that ends (end of file, next keyword) before its `=` reports "assign is incomplete: write assign name = expression;" at the end of its last token, rank 0, so it sorts before the endmodule message at the same position; the sort is stable, so `refineErrors` keeps that order. `BannerError.more` carries the errors after the first (up to three, source order); the controller fills it from `file.errors` and the banner shows "also: 9:7 missing endmodule" as a muted second line.
- Tests first: `errorMessages.test.ts` (lone assign first with endmodule second at the same spot; `assign b` without `=`; a complete assign without `;` still says missing `;`), `m10.states.spec.ts` (banner text and the `.banner-more` line, one button), `m8.editing.test.ts` (opening `p11_assign_keyword_only.v` in VS Code gives the incomplete-assign banner at 9:7 with `more` = missing endmodule).

### Bug 23: valid ports ghosted (fixed `249f830`)

- Cause: `inErrorContext(a)` climbed to the root, and tree-sitter wraps a module with a broken body (lone `assign`, or just a missing `endmodule` as in `p4_missing_endmodule.v`) in one ERROR node that starts at `module`, so every clean port declaration had an ERROR ancestor.
- Fix: the header end is the end of `module_ansi_header` (or the port list or the header node, whichever reaches furthest); the header is broken only when an ERROR or MISSING node ends inside it. A port is tentative when its own declaration has an error, or when the header is broken and the port sits under the ERROR. `p9_two_missing_commas.v` (p1c, p1d, p1e tentative via the swallowed-name and recovery paths) and the unclosed-list case (`b` tentative, its declaration holds the ERROR) behave as before.
- Tests first: `portRecovery.test.ts` (p11 keeps all twelve ports solid with the two errors in order; p4 ghosts nothing; the unclosed list and p9 still ghost what they did). `structural.test.ts` matched partial fixtures by prefix (`"p1"` also matched `p10`); it now matches `"p1_"`, which is why its expectations list changed.

### Release

- Commits: `a6835a3` docs (bugs recorded); `249f830` fix(errors) bugs 22 and 23; `edfc823` fix(ir) bug 21; version bump, CHANGELOG, README and this log in the release commit.
- Gates on the final tree: unit, golden and accuracy 643 passing (35 files); integration 19; webview 94; typecheck and lint clean; hygiene check passed; no existing file under `test/fixtures/` changed (two new partial fixtures); nothing pushed. `npm run test:perf` was not run: the Stryker workers were still using every core (load average above 25) and the 16 ms budget is only meaningful on a quiet CPU; the render path did not change in this release.
- `npm run package`: `rtl-live-0.4.1.vsix`, 22 files, 17.52 MB. `npm run test:packaged`: 19 passing against the unzipped vsix. Installed with the bundled CLI of `~/Applications/Visual Studio Code.app`; `--list-extensions --show-versions` prints `vejaysuriyaa.rtl-live@0.4.1`. Running windows need "Developer: Reload Window".

| Bug                    | Final status                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| 21 ports-only module   | fixed `edfc823` (test: `portsOnly.test.ts`; `m10.states.spec.ts` empty state and hinted ports)          |
| 22 error order         | fixed `249f830` (test: `errorMessages.test.ts`; `m10.states.spec.ts` banner list; `m8.editing.test.ts`) |
| 23 ghosted valid ports | fixed `249f830` (test: `portRecovery.test.ts`; `m8.editing.test.ts`)                                    |

Next step: none for v0.4.1; the mutation triage follows in its own section.

## Mutation testing (2026-10-23)

### Setup (`a5bb707`)

- StrykerJS 10.0.0 with the vitest runner, `stryker.config.mjs`, `npm run test:mutation`. Mutated: `src/ir`, `src/structural`, the synthesis script helpers (`script.ts`, `blackboxStubs.ts`, `yosysJson.ts`), the schedulers (`scheduler.ts`, `lifecycle.ts`, `cache.ts`, `webviewHtml.ts`), `src/shared/protocol.ts`, and the webview layout and render modules. Test suites driven: unit, golden and accuracy (`vitest.config.mts`), per-test coverage. Regex mutants are excluded (three in four of all mutants, nearly all whitespace variants of the tokenizer patterns). Reports in `artifacts/mutation/` (ignored by git); the full report is kept as `artifacts/mutation/full-mutation.json`.
- Smoke run on `width.ts` first: 131 mutants, 53 survived, all test gaps (indexed part-selects, two-digit bit selects, most constant literal forms), closed in `width.test.ts` before the full run.

### Full run

- Tree: `a5bb707` (0.3.1 plus the setup), 11350 mutants, 10 workers, 10:16 to 17:54 wall clock while the v0.4 and v0.4.1 work ran on the same machine (load average 25 to 43; the workers were paused with SIGSTOP for a few minutes of timing measurements, so a handful of in-flight mutants may be recorded as timeouts).
- Score: 61.61 percent of all mutants, 67.17 percent of covered ones. 5084 killed, 1907 timed out, 3417 survived, 940 without coverage, 2 errors. 16.5 tests per mutant on average.
- Where the survivors are (file, survived of total): `legend.ts` 344/509, `toIr.ts` 406/637, `fallbackScanner.ts` 362/989, `toVerilog.ts` 335/588, `svg.ts` 243/592, `treeSitterParser.ts` 209/1026, `tooltips.ts` 205/459, `symbols.ts` 178/429, `fromYosys.ts` 175/1037, `rtlView.ts` 172/494, `errorMessages.ts` 111/1019, `postprocess.ts` 93/536, `semantics.ts` 89/417, `cellMap.ts` 79/422, `geometry.ts` 63/133, `simplify.ts` 62/348, `blackboxStubs.ts` 58/275, `protocol.ts` 55/183. At 100 percent: `srcRange.ts`, `stableIds.ts`, `grammar.ts`; `script.ts` 98.

### Triage

Read with the survivor summary grouped by source line (string and object literal mutants set aside first; they are most of `legend.ts`, `tooltips.ts`, `symbols.ts` and `svg.ts`, where the text itself is the point and a screenshot, not a unit test, is the right check).

Real gaps, closed in `16e1e8f` (unit, golden and accuracy 673 passing, 37 files):

- `protocol.ts`: every field check in `isWebviewToHost` survived a flip to `true`, so a malformed `log`, `revealSource`, `export`, `highlighted` or `setView` message from the webview would have been accepted. One rejecting case per branch, plus the finite-generation rule on both directions.
- `semantics.ts`: the bit-range arithmetic of the multiple-driver report (`declaredRange`, `overlap`, `coversAll`) was only reached by `multi_driver.v`, a whole-signal clash. New cases: disjoint and overlapping slices, whole against slice, a reversed `[0:7]` declaration, a bit outside the declaration (no clash), two slices covering every bit (no bit list).
- `cellMap.ts`: no fixture has an inverted clock, an inverted enable or reset, `$aldff`, `$dffsr`, `$sr`, `$bmux` or `$neg`, so the pins those produce were never asserted. `cellMap.test.ts` builds the cells by hand.
- `toIr.ts`: the black-box pin direction inference (`inferPinDirection`, eleven rules) and the formal-port path for a defined module had no direct assertions. `blackboxPins.test.ts` pins every rule.
- `simplify.ts`: `dropBuffers` naming rules (keep a rename between two named nets, hand the output name to an unnamed input net, leave a buffer with a missing net alone).
- `errorMessages.ts`: comment and string masking edge cases (block comment over lines, unterminated, escaped quote), `case`/`endcase` and `begin`/`end` pairing, and the rule that an opening paren inside a port list is not an instance.

Regression found by the new tests: the 0.4.1 change for bug 21 had added instance connection identifiers to the set `inferPinDirection` reads, which turned every output wired to an instance into an input pin of that instance. The identifiers now feed only the "not driven yet" decision (`onInstance` in `toIr.ts`). Fixed in the same commit.

Survivors left as they are, with the reason:

- `fallbackScanner.ts` (362): the scanner only runs when the tree-sitter grammar fails to load; the packaged-grammar guard from 0.1.0 covers that path end to end, and the structural tests run both parsers over every fixture. Line-level assertions would duplicate the tree-sitter ones.
- `toVerilog.ts` (335): used only by the equivalence harness; its output is checked by Yosys `equiv`, so a surviving mutant there means the harness still proved equivalence.
- `postprocess.ts` (93): rewritten in `970c11a` after the run started; the report describes the old code. `test:perf` and the accuracy L3 checks cover the new one.
- `rtlView.ts` (172, lines 74 to 131): the pmux case merging has branches no fixture reaches (duplicate case inputs, a selector wider than 16 bits, all-x defaults). Candidate fixture for v0.5: a `case` with two arms selecting the same signal.
- `treeSitterParser.ts` (209): mostly the header recovery tokenizer and the error dedupe; partially covered by `partialHeader.test.ts` and `portRecovery.test.ts`, the rest needs broken inputs that are hard to write without also changing what tree-sitter yields.
- `geometry.ts`, `toElk.ts`, `logical.ts`: node size constants and layout options, checked by the accuracy layout rules, not by unit assertions on the numbers.
- `scheduler.ts`, `lifecycle.ts`, `cache.ts`: stats counters and timer bookkeeping.
- `fromYosys.ts` (175): spread over the netlist reader (bit naming preference for ports, replication detection, join ordinals); the goldens pin the output for every fixture, so these flips produce the same drawing for all of them. Worth a second pass with the replication fixtures of known issue 7.

Proof, scoped rerun on the four files with hand-built tests (`artifacts/mutation-scoped/mutation.json`, 1371 mutants, 18:01 to 18:27): `cellMap.ts` 61.6 to 87.9 percent, `protocol.ts` 41.0 to 72.8, `semantics.ts` 73.6 to 79.6, `simplify.ts` 77.6 to 81.6 (all mutants, including the string literals). What is left in `protocol.ts` is the message type name strings (30 of 50) and switch-case flips that fall through to an equivalent branch; in `semantics.ts`, `declaredRange` on a non-literal range (`[N-1:0]`, width 0) and the loop reporter, both reachable only through fixtures that do not exist yet. `toIr.ts` and `errorMessages.ts` were not rerun (1000 mutants each, most of the run time is their timeouts); their new tests fail on the unmutated rules they describe when those rules are removed by hand.

How to rerun: `npm run test:mutation` (full, several hours), or scoped with `npx stryker run --mutate src/ir/cellMap.ts --incremental false` (the CLI has no flag for the report file name; to keep the full report, point a small config that spreads `stryker.config.mjs` and sets `jsonReporter.fileName` at `--configFile`). Survivor summaries: group the json by file and line, non-string mutators first.

Next step: a `case` fixture with duplicate arms for `rtlView.ts`, and a replication fixture pass over `fromYosys.ts`; both are v0.5 candidates, not blockers.

## v0.5 work log (2026-10-23)

Scope: the v0.5.0 brief (cross-platform tool lookup, CI, Marketplace readiness; no publishing). Baseline at `9c8f63c`: unit, golden and accuracy 673 passing (37 files); integration 19; webview 94; packaged 19.

### Part A: tool lookup (`dcf3e5c`)

- `src/synth/toolLookup.ts` is the one place that finds `yosys`, `verilator`, `iverilog` and `vvp`. Order: the setting; every PATH folder (platform delimiter; on Windows `PATHEXT` names with `.exe` first, then the bare name); the common folders (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `~/.local/bin`, `~/oss-cad-suite/bin`, `/opt/oss-cad-suite/bin`, `~/opt/oss-cad-suite/bin`; on Windows `oss-cad-suite\bin` under `LOCALAPPDATA`, `ProgramFiles`, `C:\` and the home folder). `locateTool` probes each existing candidate with its version flag (3 s, `execFile` with an args array, `windowsHide`) and records every skip with a reason; `.cmd` and `.bat` wrappers are skipped because they need a shell. `findToolSync` is the unverified variant for tests and the bench. The file and process probes are injected, so the unit tests fake Linux, macOS and Windows layouts.
- `SynthManager` resolves yosys inside `createBackend` and verilator at construction and on a `rtlLive.verilatorPath` change; it keeps both `LookupResult`s, logs each `describeLookup` line, sets `backendPath`, and shows the one-time fallback notice (`fallbackMessage`: only when the setting was `auto` or `native` and nothing usable was found; it names a setting that points nowhere or at a broken binary) with a "Show tool paths" button. The controller reads `synth.verilatorPath` instead of probing the disk at every lint.
- Visible: `StatusInfo.backendPath`; the badge tooltip gets an "Engine:" line (`engineLine` in chrome.ts); command `rtlLive.showToolPaths` ("RTL Live: Show Tool Paths") prints the report to the output channel (tool lines, skips, the engine in use, platform and PATH folder count) and shows it. `log.recent()` keeps the last 400 lines; `RtlLiveTestApi.logLines()` exposes them.
- Settings: `rtlLive.verilatorPath` added; `rtlLive.yosysPath` description rewritten.
- Tests first: `test/unit/toolLookup.test.ts` (10 cases: posix and Windows candidate order, setting over PATH, broken binary skipped with reason, nothing found with the searched list, `.cmd` skipped, version parsing, the notice rules); `m10.states.spec.ts` (tooltip per engine); `m11.tools.test.ts` (the command in VS Code with a bogus `rtlLive.yosysPath`, reported as skipped, engine and platform lines present).

### Part B: CI and cross-platform fixes (`5b990cf`)

- `.github/workflows/ci.yml`: matrix ubuntu-latest, macos-latest, windows-latest; `actions/checkout@v4`, `actions/setup-node@v4` (Node `lts/*`, npm cache); `npm ci`, build, typecheck, lint, `vitest run` with `RTL_LIVE_TEST_BACKEND=wasm`, `playwright install --with-deps chromium`, `playwright test`, `vscode-test` (`xvfb-run -a` on Linux), then on Ubuntu `apt-get install yosys iverilog` and a second `vitest run` with `RTL_LIVE_TEST_BACKEND=native`, then `npm run package` and an artifact upload per OS (plus `artifacts/` and the VS Code logs on failure). Concurrency cancels a superseded run on the same ref.
- Found and fixed locally: every script and `esbuild.config.mjs` and `test/isolation.mjs` resolved their folder with `new URL(...).pathname`, which is `/C:/...` on Windows; now `fileURLToPath`. `scripts/test-packaged.mjs` unzips with `Expand-Archive` on Windows and starts `npm`/`npx` through the shell there (they are `.cmd` shims; the arguments are fixed strings). `test/accuracy/equivalence.ts` hardcoded `/opt/homebrew/bin/iverilog`; it now uses the shared lookup, and `accuracy.test.ts` records L1 as `skipped` and leaves `|L1` entries out of the known-failure comparison when Icarus is missing (rehearsed with `RTL_LIVE_IVERILOG=off`: 45 passing, every L1 "n/a", baseline still enforced for L2 and L3). Nothing in `src/` used a hardcoded separator.
- `.gitattributes`: `* text=auto eol=lf` plus binary entries (wasm, png, ttf, tar, vsix, gif, ico). The index already held every text file as LF (`git ls-files --eol`: 358 LF, 12 binary), so no renormalisation and no fixture changed.
- What to check on the first CI run (the workflow only runs after a push): (1) Windows: `vscode-test` downloading VS Code and launching with the long `--user-data-dir` path; (2) Windows: the Playwright harness server and `tree-sitter` wasm loading under the LF checkout; (3) macOS runner: no Yosys, so the wasm engine's 80 MB cold start must fit the 20 s preload in `synthHelpers` (`timeoutMs: 20_000` per synth); (4) Ubuntu apt Yosys is 0.33 on 24.04: the feature-flag retry for `-noscopeinfo` and `proc -norom` must engage, watch for golden diffs from an older Yosys (if they appear, pin the native run to the OSS CAD Suite nightly instead of apt); (5) the integration suite's VS Code download on three runners doubles the run time; cache `.vscode-test/` with `actions/cache` if it exceeds 15 minutes.

### Part C: Marketplace readiness (release commit)

- package.json: description rewritten, `repository`, `bugs`, `homepage` (GitHub), categories Programming Languages, Visualization, Education; keywords verilog, systemverilog, schematic, rtl, hdl, yosys, fpga, digital design, netlist, diagram; `galleryBanner` `#1b2430` dark; `preview: true`; `engines.vscode` stays `^1.100.0` (May 2025). `private: true` stays: it only stops `npm publish`, `vsce` does not read it.
- Icon: `media/icon.png` is already a 128 x 128 RGBA PNG (an AND gate on a dark rounded square), readable at 32 px; unchanged.
- README rewritten for strangers: hero screenshot (`media/screenshots/7458.png`, served from the repository once it is public because `repository` is set), two-sentence pitch, install table per OS (Homebrew, apt, OSS CAD Suite), the lookup order, features, settings, known limitations, privacy, troubleshooting, architecture, development, CI badge at the top.
- `vsce ls` lists 20 files: the four docs, package.json, the two icons and the 13 `dist/` bundles and assets; nothing else ships. `npm run package` finished with no warnings: `rtl-live-0.5.0.vsix`, 22 files, 17.52 MB.

### How to publish (user steps, nothing done here)

1. Push `main` to GitHub so the README images and the CI badge resolve.
2. Create a publisher at https://marketplace.visualstudio.com/manage with the id `vejaysuriyaa` (the `publisher` field), signed in with the Microsoft account you want to own the listing.
3. Upload `rtl-live-0.5.0.vsix` on the management page ("New extension", "Visual Studio Code"), or run `npx vsce publish` after `npx vsce login vejaysuriyaa` with a Personal Access Token (Azure DevOps, scope "Marketplace: Manage"). Keep the token out of the repository.
4. The listing shows the README, the icon and the gallery banner; `preview: true` adds the Preview tag. Remove it when the first feedback round is in.
5. After publishing, replace the install line in README with the Marketplace link and tag the release (`git tag v0.5.0`).

### Release

- Commits: `dcf3e5c` feat(tools); `5b990cf` ci; release commit with version 0.5.0, CHANGELOG, README, the `RTL_LIVE_IVERILOG=off` rehearsal switch in `equivalence.ts`, and this log.
- Gates on the final tree: unit, golden and accuracy 685 passing (38 files), also green with `RTL_LIVE_TEST_BACKEND=wasm` and with Icarus hidden; integration 20 (M11 is new); webview 96; packaged 20 against the vsix; typecheck and lint clean; hygiene check passed; no existing file under `test/fixtures/` changed; nothing pushed, no account or token touched.
- Installed with the bundled CLI of `~/Applications/Visual Studio Code.app`; `--list-extensions --show-versions` prints `vejaysuriyaa.rtl-live@0.5.0`. Running windows need "Developer: Reload Window".

### First CI run (40053384002): fixed

- All three runners failed in the unit step at `test/accuracy/harness.test.ts` lines 26, 32 and 58: the L1 harness asserted that Icarus Verilog is installed and ran simulations, while the accuracy suite had already learned to skip L1 without it. The three failures reproduce locally with `RTL_LIVE_IVERILOG=off` (3 failed, 14 passed) and the full suite then passes with 4 skips (681 passed, 4 skipped) and with Icarus present 685 passed, 17 of 17 harness tests running.
- Fix: the four simulation tests call `ctx.skip("iverilog not installed; the L1 simulation checks are skipped here")` when `icarusAvailable()` is false; the first test now reads "icarus is installed, so the simulation checks below run" and still asserts availability when it runs. The pure tests (export refusal, x/z masking, clock detection, testbench text) run everywhere.
- CI: Icarus is installed before the unit step where it is easy (`apt-get install iverilog` on Ubuntu, `brew install icarus-verilog` on macOS), so the equivalence checks really run on two of the three runners; Windows stays skipped. `actions/checkout`, `actions/setup-node` and `actions/upload-artifact` moved to `@v7`, their current majors on the Node 24 runtime (checkout and setup-node switched to node24 at v5, upload-artifact at v6; the run warned that Node 20 is deprecated). Ubuntu pinned to `ubuntu-24.04` so a future `ubuntu-latest` move cannot change the toolchain unannounced.
- Check on the next CI run: (1) macOS `brew install icarus-verilog` time and that the harness tests show as run, not skipped, in the vitest output; (2) Ubuntu apt `iverilog` is 12.0 and `yosys` 0.33 on 24.04: watch the native-engine step for golden diffs and the feature-flag retry; (3) Windows shows "4 skipped" in the unit step and nothing else about iverilog; (4) the `@v7` actions start without a runner-version complaint (hosted runners are current; only self-hosted ones below v2.327.1 would fail); (5) the integration step on all three, which the first run never reached.

### Second CI run (40054775588): fixed

- Integration failed on all three OSes, M11 only: `AssertionError: engine line` at `m11.tools.test.js:97`. Cause: the test waited for a `synthesis backend:` log line, but `log.recent()` keeps the last 400 lines, so it matched the line of the engine the earlier tests had loaded. Setting the bogus `rtlLive.yosysPath` restarts the lookup and, on a runner without Yosys, the 80 MB wasm reload; Show Tool Paths ran in that window with no backend and printed `not started`. Reproduced locally with `RTL_LIVE_YOSYS=off npx vscode-test -g M11`: 1 failing, the same assertion; after the fix 1 passing with Yosys hidden and with Yosys present.
- Fix: `describeEngine()` (pure, `toolLookup.ts`) gives the report one engine line in every state: `built-in wasm yosys, loading` while warming up, `not decided yet, looking for yosys` during the lookup, `not started`, `off`, or the engine in use. `SynthManager.whenDecided()` and the test API `whenEngineDecided()` resolve with the chosen engine once the current lookup and load are done. M11 now reads the report once right after the setting change (an engine line must be there), waits for the decision, then expects `native yosys ... at <path>` when the yosys line names a path and `built-in wasm yosys <version>` when it says not found.
- `RTL_LIVE_YOSYS=off` (and `RTL_LIVE_<TOOL>=off` in general) makes the lookup skip every existing candidate with the reason `hidden by RTL_LIVE_YOSYS=off`; `findToolSync` returns nothing. Same pattern as `RTL_LIVE_IVERILOG=off`. Documented in README (Development) and CHANGELOG.
- The `yowasp-yosys: fetched N%` lines are the yowasp runtime's default progress wording; under Node a `file:` URL is read with `fs.readFile` (`@yowasp/runtime/lib/fetch.js`, and `fetchCompile` in the component glue), and the worker imports the bundle by `import.meta.url`, so nothing is downloaded. `test/unit/wasmOffline.test.ts` imports the engine with `globalThis.fetch` replaced by a rejecting stub and asserts `-V` still answers and fetch was never called. The worker now passes its own `fetchProgress` and logs `built-in yosys: loading bundled files from disk, N% of M bytes` at 25 percent steps.
- Gates: vitest 688 passing (39 files; 3 new: the switch, `describeEngine`, offline start); webview 96; integration 20 with Yosys present and 20 with `RTL_LIVE_YOSYS=off`; typecheck and lint clean; hygiene check passed.

### Third and fourth CI runs (40058409524, 40075700936): fixed (2026-10-24)

- Unit, accuracy and webview steps passed on all three OSes in both runs; Windows was green end to end; macOS printed the `built-in yosys: loading bundled files from disk` lines; the `@v7` actions started cleanly.
- Ubuntu, native Yosys step, both runs: every synthesis test failed with `Command syntax error: Unknown option or option in arguments.` at `write_json -noscopeinfo out.json`. The apt package on 24.04 is Yosys 0.33, which predates the flag. The extension retries without it (`synthManager.ts`), but the vitest harness calls `synthesize()` directly and has no retry, so the step can only pass with a current Yosys. Fix: the workflow downloads the OSS CAD Suite Linux release (`OSS_CAD_SUITE` job variable, pinned by date tag, 750 MB tgz from GitHub releases, `bin/` appended to `GITHUB_PATH`), then `node scripts/check-yosys.mjs` prints `yosys -V`, writes `ok` and `version` to `GITHUB_OUTPUT` and emits a `::notice` when the version is below 0.40 or yosys is missing; the native step runs only when `ok == 'true'`. The script's three functions (`parseYosysVersion`, `compareVersions`, `yosysIsRecentEnough`) have unit tests (`test/unit/checkYosys.test.ts`, 3 failing before the script existed, 3 passing after). The skip paths were exercised locally with a fake `yosys` printing 0.33 (notice, `ok=false`, `version=0.33`) and with no yosys on PATH (`ok=false`, `version=none`). The release asset URL answers 302 (exists).
- macOS, integration step, run three only: `M8 editing` bug 2 timed out after 60 s waiting for `synthesized again`, and `M8 error messages` bug 3 after 10 s waiting for `clean again`. Both waits came right after `vscode.commands.executeCommand("undo")`; the edits before them had rendered (stale status and the overlay arrived), and nothing rendered after the undo. The same tests took about 1 s in runs two and four on macOS and on Linux and Windows every time, so this is a timing-dependent failure of the undo command reaching the editor, not of the extension. VS Code routes `undo` to the code editor that has text focus, then to the active editor; on a slow runner the focus can still be moving (the view container and the webview had just been opened). The root cause could not be confirmed because the run's extension log was not uploaded: the artifact step pointed at `.vscode-test/user-data/logs/`, but the suite runs in a temp profile (`test/isolation.mjs`).
- Fix, three parts. (1) The tests restore the text through the API instead of the undo command: `restoreText(doc, text)` in `test/integration/util.ts` applies a `WorkspaceEdit` replacing the whole document and asserts the text is back; M8 bug 2, M8 bug 3 (four places) and the M6 stale-badge test use it (the M6 title now says "restoring the text clears it"). The extension sees the same `onDidChangeTextDocument` either way. (2) `test/integration/zz.failure-log.test.ts`: a root `teardown` (mocha tdd) that prints the extension's last 60 log lines, its status and the active editor after any failed test, and never throws (proved with a temporary failing test: the dump appears, the other 20 tests still run; and with a test failing before activation: "extension not activated"). (3) `test/isolation.mjs` honours `RTL_LIVE_IT_ROOT`: the profile lives at `<root>/<label>`, emptied first and kept afterwards; CI sets it to `${{ runner.temp }}/rl` and uploads `rl/*/ud/logs/`. A root over 85 characters is refused on macOS (the IPC socket path limit; the scratch folder of this session was over 100 and failed with `listen EINVAL`). Unit test added in `isolation.test.ts`.
- Review before the commit found one blocker and four nits, all fixed: `RTL_LIVE_IT_ROOT` was a job-level variable, so the wasm vitest step would have failed the isolation test on every OS (the profile must be under the temp folder there); it is now set on the two integration steps only, which also keeps the profile logs from being emptied by the later native step. The install step is `continue-on-error` so a failed download ends in the check script's skip notice, not a red job; the macOS root guard is 80 characters (85 plus `/ud/1.106-main.sock` is exactly the 104 byte limit); the script's "invoked directly" check tolerates a non-path `argv[1]`; the Icarus shadowing by the suite's `bin/` is documented in the workflow.
- Gates on the final tree: vitest 692 passing (40 files) with native Yosys 0.70 and with `RTL_LIVE_TEST_BACKEND=wasm`; integration 20 with the kept profile root and 20 with `RTL_LIVE_YOSYS=off`; typecheck and lint clean; hygiene check passed. Correction to the environment notes: a native Yosys 0.70+post is installed at `/opt/homebrew/bin/yosys`, so vitest uses the native backend here by default.

Next step: push `main`, watch CI run five: the Ubuntu native step must show the OSS CAD Suite version in "Check the Yosys version" and no golden diffs; integration green on all three OSes; if macOS fails again, the uploaded `artifacts-macos-latest` now contains the profile logs and the failed test prints the extension log.
