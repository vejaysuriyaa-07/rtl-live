# RTL Live: build notes

Resume point for every session. Short on purpose: current status, open issues, decisions, next step.
Full phase-by-phase logs (M0 to M7, v0.2 to v0.5, mutation testing, CI runs) are in `NOTES-archive.md`;
open it only when a detail is needed, by heading. New work logs go to the archive; this file is rewritten
in place so it stays under about 2,000 words.

## Current version and status (2026-10-24)

- Version 0.5.1 (release commit on top of `6084a1c`): the IR order no longer follows the Yosys build, the
  junction clearance axis fix, Show Tool Paths always names the engine, CI green on all three OSes (run six).
  `rtl-live-0.5.1.vsix` (20 files, 17.5 MB) built, packaged suite 20 passing, installed as
  `vejaysuriyaa.rtl-live@0.5.1`.
- Gates on the current tree: vitest unit, golden and accuracy 694 passing (40 files) with brew Yosys 0.70+post,
  with the OSS CAD Suite 0.70+219 and with `RTL_LIVE_TEST_BACKEND=wasm`; also green with Icarus hidden
  (`RTL_LIVE_IVERILOG=off`); integration 20 (also 20 with `RTL_LIVE_YOSYS=off`); webview 96; packaged 20
  against the vsix; typecheck and lint clean; hygiene check passed.
- Running VS Code windows need "Developer: Reload Window" after an install.
- CI (`.github/workflows/ci.yml`, Ubuntu 24.04, macOS, Windows): run one failed in the accuracy harness without
  Icarus (fixed), run two in M11 (fixed), runs three and four in the Ubuntu native-Yosys step (apt Yosys 0.33
  rejects `write_json -noscopeinfo`; fixed by installing the OSS CAD Suite release, pinned by the `OSS_CAD_SUITE`
  date tag, with `scripts/check-yosys.mjs` skipping the step with a notice when Yosys is missing or below 0.40).
  Run three also had two M8 timeouts on macOS right after the `undo` command (runs two and four passed); the
  tests now restore text with a `WorkspaceEdit`, a root hook prints the extension log on failure, and the
  profile logs upload from `RTL_LIVE_IT_ROOT`. Run five: macOS and Windows green; Ubuntu native step showed
  that the IR order followed Yosys's cell names (changed in 0.70+219); fixed in `fromYosys.ts` (see archive,
  "Fifth CI run"). Run six (40088822763, commit `14d5fb1`): green on all three OSes; Ubuntu 3m55s with the
  native step at 694 passing on Yosys 0.70+219, macOS 3m31s, Windows 7m37s.
- Published 2026-10-24: https://marketplace.visualstudio.com/items?itemName=vejaysuriyaa.rtl-live shows 0.5.1 with the
  Preview tag. CI run seven (`42900d8`) green on all three OSes.

## Next step

1. VJ tags the release (`git tag v0.5.1`, push the tag) and pushes the README commit with the Marketplace link.
3. Candidate v0.6 work, in this order: a `case` fixture with duplicate arms (rtlView pmux merging), a replication
   fixture pass over `fromYosys.ts`, then the open issues below.

## Open issues

Drawing and model:

- Structural boxes are not overlaid on a stale synthesized diagram; the last good diagram stays until the file
  synthesizes again. Source lines in tooltips come from the newest text, so line numbers can drift by a line or
  two while a stale diagram is shown.
- Replicated groups (`{5{a,b,c,d,e}}`) expand to one join input per bit.
- `$logic_and` and `$logic_or` draw as AND/OR symbols with bus inputs; a distinct "logic" glyph would help.
- Bus width labels can touch the port chevron on very short first segments.
- Yosys front-end folds `state == 1'b1` (fsm_moore keeps no comparator).
- Structural view L1: logic clouds have no netlist (accuracy report L1 4/44 for the structural view).
- pmux case merging in `rtlView.ts` has branches no fixture reaches (duplicate case inputs, selector wider than
  16 bits, all-x defaults). `fromYosys.ts` has 175 surviving mutants spread over bit naming, replication
  detection and join ordinals.

Deferred features (from v0.3 and v0.4 lists):

- Minimap, print-ready export with a white background, grid-snapped routing, monospace signal names and the
  full line-weight pass, selection accent on connected nets beyond focus mode, a bubble on negative-latch clock pins.
- A2 badges for undriven outputs, unused inputs and latches inferred from incomplete `case`.
- Golden screenshot comparison on every change (the contact sheet is reviewed by eye today).
- Automation of the manual checks A1 and A3 to A6 (v0.2 log, "Manual checks").
- Part C: search, trace drivers and loads, cones, path view, stats, simulation values.
- Cursor highlight for nets by name (only declaration ranges today); an outline of module ports when a file has
  several modules.

Platform:

- The yowasp wasm needs the `exnref` flag on Node below 24; the worker sets it. If a future VS Code ships an
  older V8, the wasm engine fails to compile and the extension falls back to the structural view (logged).
- Confirmed by CI runs three and four: Windows `vscode-test` with the long `--user-data-dir`, Playwright and
  tree-sitter wasm under an LF checkout on Windows, macOS wasm cold start inside the preload, run time 3 to 9
  minutes per OS. Still open: the extension's own `-noscopeinfo` / `proc -norom` retry against an old native
  Yosys is only unit-tested (CI now uses a current Yosys); the macOS M8 timeout of run three has no confirmed
  root cause, only a test that no longer depends on the `undo` command and logs that upload next time.

## Key decisions

- Two layers: structural (web-tree-sitter) and synthesis (native Yosys or `@yowasp/yosys` in a worker
  thread) feed one IR, then ELK layout, then SVG. No network at runtime, no telemetry; the wasm engine loads
  its files from disk (`test/unit/wasmOffline.test.ts` proves fetch is never called).
- Tool lookup lives in `src/synth/toolLookup.ts` only: the setting first, then every PATH folder, then the
  common folders (Homebrew, `/usr/local/bin`, OSS CAD Suite locations, Windows equivalents). Each candidate is
  probed with its version flag (3 s, `execFile` with an args array); `.cmd` and `.bat` wrappers are skipped.
  Nothing falls back silently: a one-time notice names the setting that points nowhere, and "RTL Live: Show
  Tool Paths" prints the report with one engine line in every state (`describeEngine`).
- Test switches: `RTL_LIVE_TEST_BACKEND=wasm|native`, `RTL_LIVE_<TOOL>=off` hides a tool from the lookup
  (used to rehearse runners without Yosys or Icarus). L1 equivalence checks skip, not fail, without Icarus.
  `RTL_LIVE_IT_ROOT=<short path>` keeps the integration suite's VS Code profile for log collection (CI sets it).
  Integration tests change documents only through the API (`editor.edit`, `restoreText`), never through
  focus-dependent commands such as `undo`.
- Integration tests are bundled by esbuild to `dist/test/integration/*.test.js` (cjs, `vscode` and `mocha`
  external) and run by `@vscode/test-cli` with the tdd UI. The webview falls back to an in-page stub when
  `acquireVsCodeApi` is absent, so the same `dist/webview.js` runs under Playwright
  (`window.__rtlLiveTestHooks.posted` collects messages).
- `SchematicViewProvider` replays the last `render`, `status`, `error` and `theme` message when a webview
  becomes ready, so hide/show and "Open in editor panel" start with the current diagram.
- Never use Yosys auto-generated cell names as IDs (`stableIds.ts`), and never let their order through either:
  `fromYosys.ts` sorts net names, iterates cells in source order and inserts nets ports-first, so the IR and the
  drawing are the same for every Yosys build (0.70+219 renamed the auto cells, which reordered `write_json`).
  Errors are caught at layer boundaries and turned into Diagnostics, never thrown into VS Code.
- `.gitattributes`: `* text=auto eol=lf` plus binary entries; the index was already all LF, no fixture changed.
  Scripts resolve their folder with `fileURLToPath`, never `new URL(...).pathname` (breaks on Windows).
- Mutation testing: StrykerJS 10 with the vitest runner (`npm run test:mutation`, several hours; scoped runs
  with `npx stryker run --mutate <file> --incremental false`). Regex mutants excluded. Score 61.6 percent of
  all mutants, 67.2 of covered. String and object literal survivors in legend, tooltips, symbols and svg are
  accepted (screenshots are the right check there); the survivor triage and reasons are in the archive.
- `package.json` keeps `private: true` (only stops `npm publish`; vsce ignores it), `preview: true`,
  `engines.vscode ^1.100.0`. `vsce ls` ships 20 files: docs, package.json, two icons, 13 `dist/` bundles.
- Working directory is `/Users/vejaysuriyaa/rtl-live/` (the first spec said "this empty directory").

## Environment (verified 2026-10-22)

- macOS 15.1, Apple Silicon. Node v23.1.0, npm 10.9.0, git 2.47.0.
- Native yosys 0.70+post at `/opt/homebrew/bin/yosys` (found 2026-10-24; earlier notes said none), so vitest and
  the integration suite use the native backend here; `RTL_LIVE_TEST_BACKEND=wasm` and `RTL_LIVE_YOSYS=off`
  rehearse the wasm path.
- verilator 5.052 and iverilog at `/opt/homebrew/bin`. docker at `/usr/local/bin/docker`. emcc not installed.
- `code` CLI: use the bundled one in `~/Applications/Visual Studio Code.app` (not on PATH).

## Pinned versions

| Package | Version | Role |
| --- | --- | --- |
| typescript | 5.9.3 | strict typecheck |
| esbuild | 0.28.2 | all bundles |
| web-tree-sitter / tree-sitter-cli | 0.27.1 | parser runtime and grammar wasm build |
| tree-sitter-verilog | 1.0.0 | grammar (npm's latest; the spec said 1.0.3) |
| @yowasp/yosys | 0.70.1258 | wasm synthesis backend |
| elkjs | 0.12.0 | layout |
| d3-selection / d3-zoom | 3.0.0 | pan and zoom |
| vitest | 5.0.5 | unit and golden tests |
| @vscode/test-cli / test-electron | 0.0.15 / 3.1.0 | integration tests |
| mocha | 12.0.3 | integration test runner |
| @playwright/test | 1.64.1 | webview tests and screenshots |
| @vscode/vsce | 4.0.0 | packaging |
| eslint / typescript-eslint | 9.39.5 / 8.72.0 | lint |
| prettier | 3.9.10 | format |
| @types/vscode | 1.100.0 | engine ^1.100.0 |
| StrykerJS | 10.0.0 | mutation testing |

## Where to look in the archive

`NOTES-archive.md` headings: Environment, Pinned versions, Decisions, M0 to M7 (first build, bench numbers,
packaging, final checklist), Addendum native yosys, Addendum installed vsix bugs, v0.2 work log (phases 0 to 7,
manual checks, deferred list), v0.3 work log (bugs 8 to 18, accuracy report figures), v0.3.1 (bugs 19, 20),
v0.4 (tokens, shapes, toolbar, performance), v0.4.1 (bugs 21 to 23), Mutation testing (setup, full run, triage,
scoped rerun), v0.5 work log (tool lookup, CI, Marketplace readiness, how to publish, CI runs one and two).
