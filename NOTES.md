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
