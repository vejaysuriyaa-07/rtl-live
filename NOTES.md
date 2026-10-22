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

| fixture | nodes | structural tree-sitter p95 | structural fallback p95 | wasm warm p50 / p95 | ELK p50 / max |
| --- | --- | --- | --- | --- | --- |
| 7458.v | 6 | 5.0 | 1.4 | 33 / 55 | 20.3 / 115.2 |
| arith_compare.v | 4 | 2.1 | 0.3 | 12 / 17 | 10.0 / 17.8 |
| counter4.v | 5 | 1.3 | 0.2 | 13 / 16 | 15.4 / 22.1 |
| dff_async.v | 1 | 0.6 | 0.0 | 14 / 23 | 8.0 / 12.5 |
| fsm_moore.v | 7 | 1.1 | 0.1 | 15 / 18 | 16.5 / 28.8 |
| gates4.v | 3 | 0.4 | 0.0 | 10 / 14 | 5.7 / 6.5 |
| module.v | 1 | 0.5 | 0.1 | 31 / 331 | 8.1 / 9.3 |
| module_add.v | 6 | 2.0 | 0.1 | 17 / 21 | 9.4 / 14.5 |
| module_add_full.v | 6 | 2.5 | 0.3 | 13 / 18 | 9.8 / 10.1 |
| module_name.v | 1 | 0.5 | 0.0 | 11 / 14 | 7.1 / 8.6 |
| module_pos.v | 1 | 0.6 | 0.0 | 12 / 14 | 6.4 / 6.8 |
| module_shift.v | 3 | 1.4 | 0.0 | 12 / 16 | 5.8 / 6.4 |
| module_shift8.v | 11 | 1.8 | 0.1 | 27 / 373 | 30.6 / 35.0 |
| multi_module.v | 1 | 0.7 | 0.0 | 13 / 17 | 4.9 / 6.6 |
| mux2_always.v | 4 | 0.6 | 0.0 | 15 / 19 | 14.9 / 22.4 |
| notgate.v | 1 | 0.1 | 0.0 | 22 / 36 | 5.0 / 5.5 |
| shift4.v | 3 | 0.6 | 0.0 | 12 / 18 | 7.8 / 8.0 |
| vector0.v | 1 | 0.6 | 0.0 | 10 / 11 | 5.0 / 6.7 |
| vector2.v | 2 | 1.0 | 0.0 | 11 / 261 | 6.4 / 7.8 |
| vector3.v | 8 | 0.5 | 0.0 | 13 / 16 | 9.6 / 10.3 |
| vector4.v | 2 | 0.4 | 0.0 | 10 / 12 | 5.2 / 7.3 |
| vector5.v | 3 | 0.8 | 0.0 | 14 / 16 | 14.1 / 28.2 |
| vectorgates.v | 5 | 0.7 | 0.0 | 17 / 27 | 8.5 / 9.1 |
| vectorr.v | 2 | 1.2 | 0.1 | 11 / 12 | 6.4 / 7.0 |
| wire.v | 0 | 0.1 | 0.0 | 10 / 12 | 4.1 / 4.7 |
| wire4.v | 0 | 0.4 | 0.0 | 21 / 28 | 5.6 / 6.2 |
| xnor_misc.v | 3 | 0.6 | 0.0 | 13 / 17 | 7.2 / 8.7 |

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

| fixture | nodes | native warm p50 / p95 (ms) | wasm warm p50 / p95 (ms) |
| --- | --- | --- | --- |
| 7458.v | 6 | 12 / 14 | 33 / 39 |
| arith_compare.v | 4 | 10 / 11 | 12 / 12 |
| counter4.v | 5 | 12 / 13 | 11 / 12 |
| dff_async.v | 1 | 11 / 11 | 11 / 12 |
| fsm_moore.v | 7 | 11 / 11 | 11 / 14 |
| gates4.v | 3 | 10 / 11 | 9 / 11 |
| module.v | 1 | 13 / 13 | 19 / 303 |
| module_add.v | 6 | 12 / 13 | 15 / 28 |
| module_add_full.v | 6 | 12 / 12 | 13 / 17 |
| module_name.v | 1 | 12 / 13 | 11 / 12 |
| module_pos.v | 1 | 10 / 13 | 11 / 12 |
| module_shift.v | 3 | 11 / 11 | 10 / 13 |
| module_shift8.v | 11 | 19 / 21 | 25 / 358 |
| multi_module.v | 1 | 11 / 14 | 14 / 18 |
| mux2_always.v | 4 | 11 / 11 | 13 / 14 |
| notgate.v | 1 | 11 / 12 | 10 / 13 |
| shift4.v | 3 | 10 / 11 | 13 / 17 |
| vector0.v | 1 | 11 / 12 | 11 / 12 |
| vector2.v | 2 | 12 / 12 | 10 / 277 |
| vector3.v | 8 | 11 / 11 | 13 / 16 |
| vector4.v | 2 | 12 / 13 | 10 / 12 |
| vector5.v | 3 | 14 / 16 | 13 / 15 |
| vectorgates.v | 5 | 10 / 12 | 13 / 15 |
| vectorr.v | 2 | 10 / 11 | 10 / 11 |
| wire.v | 0 | 10 / 10 | 9 / 11 |
| wire4.v | 0 | 10 / 12 | 17 / 34 |
| xnor_misc.v | 3 | 13 / 14 | 13 / 18 |

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

| VS Code | extension loaded as | other extensions | launch |
| --- | --- | --- | --- |
| 1.143.0 (test download) | unzipped vsix, dev mode | disabled | vscode-test |
| 1.106.3 (download) | unzipped vsix, dev mode | disabled | vscode-test |
| 1.106.3 `~/Applications` binary | unzipped vsix, dev mode | `~/.vscode/extensions` enabled | vscode-test |
| 1.143.0 | unzipped vsix, dev mode | `~/.vscode/extensions` enabled | vscode-test |
| 1.106.3 `~/Applications` app | installed with `code --install-extension` into a temp extensions dir | none | `open -a` (translocated, like the real app) with a probe `extensionTestsPath` |
| 1.106.3 `~/Applications` app | installed by the CLI into the running window, no reload | none | `open -a` |

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
