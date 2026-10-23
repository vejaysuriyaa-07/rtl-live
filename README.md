# RTL Live

Live Verilog schematic viewer in the VS Code sidebar. The structural view updates as you type; the gate-level view is synthesized with Yosys (native or the bundled wasm build) whenever the file parses cleanly. Built for learning Verilog on HDLBits: type a module header and the box appears, add an `assign` and the gate appears.

Screenshots are in `media/screenshots/` (vsce cannot embed images without a published repository): `7458.png` and `module_add.png` (the v0.4 look), `before-after.png` (7458 in 0.3.1 and 0.4.0 side by side), `vectorgates-logical.png` (logical OR drawn with "any 1?" boxes), `legend-dark.png` (the Legend panel), `focus-mode.png` (hovering a wire), `contact-sheet.png` (every fixture at a glance).

## First run

1. Run `code --install-extension rtl-live-0.4.0.vsix --force`, then Cmd+Shift+P, "Developer: Reload Window".
2. Optional, faster synthesis: `brew install yosys`. Without it the bundled wasm engine is used, and its first run takes a few seconds.
3. Click the RTL Live icon in the Activity Bar to open the "Schematic" view. You can drag it to the secondary side bar.
4. 10-minute manual check using `test/fixtures/hdlbits/`:
   - (1 min) In a new `scratch.v`, type `module top_module(input a, output b);` slowly. The box with `a` and `b` appears before you finish.
   - (1 min) Type `assign b = ~a;` then `endmodule`. The badge turns green and a NOT gate appears.
   - (1 min) Open `7458.v`. Check four ANDs (two 3-input), two ORs and nets w1..w4. Hover a gate to see its line; click it to jump there.
   - (1 min) Put the cursor on `assign p1y = w2 | w4;`. The matching OR gate highlights.
   - (1 min) Delete `endmodule`. The diagram stays, with an amber Stale badge and a banner. Undo, and both clear.
   - (1 min) Open `vector2.v` and `vector4.v`. Look for bus slashes, widths and bit-range rippers.
   - (1 min) Open `module_add.v`. Expect two dashed `add16` boxes, the carry wire, and `1'b0` on `cin`. In `module_add_full.v`, double-click `add16` to drill in, then use the breadcrumb to go back.
   - (1 min) Open `module_shift8.v`, `counter4.v` and `fsm_moore.v`. Expect a mux trapezoid, DFFs with clock triangles, and the adder feedback loop.
   - (1 min) Switch between a light and a dark theme (Cmd+K Cmd+T). Colours should follow.
   - (1 min) Try the toolbar: export SVG (dark lines on white, ready for a document), open in editor panel, fit, Legend. Hover a wire to focus its net; hover `||` in `vectorgates.v` to read what a logical OR does.
5. If anything looks wrong, run "RTL Live: Show Log" and read "Known issues" in NOTES.md.

If `code` is not on your PATH, run "Shell Command: Install 'code' command in PATH" from the Command Palette first, or use `"$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"`.

## Features

- Structural view while typing: module box, ports with widths, wires, instances, and dashed "logic clouds" for `assign` and `always` blocks. Half-typed or broken code never blanks the view.
- Two synthesized views, switched with the RTL / Gate toggle in the toolbar. RTL view is shaped like the source: a `case` is one N:1 mux with inputs labelled by select value, `cond ? x : y` a 2:1 mux with `0` and `1`, `if (en)` on a flop an EN pin, a synchronous reset an R pin, word-level `+`, `==`, `<` single boxes. Gate view is what synthesis builds: enables and resets become muxes in front of plain flops.
- IEEE/ANSI gate symbols (AND, OR, XOR, NOT, BUF; NAND, NOR, XNOR with an output bubble, N inputs on one symbol), reduction gates, flip-flops with a clock triangle, latches without one and with a warning badge, arithmetic and comparator boxes, constants, split/join rippers for bit-selects, part-selects, concatenation and replication.
- Logical operators drawn the way they work: `a || b` on buses goes through "any 1?" boxes (OR of all bits) into a plain 1-bit OR tagged "logical"; `!a` on a bus is one "all 0?" box; 1-bit inputs keep the plain gate.
- Every element explains itself on hover in one plain sentence and quotes the source line it came from: wires ("3 separate wires drawn as one line (a bus)"), junction dots ("Wires connect here"), plain crossings ("These wires cross but do not connect"), bubbles, pins, slashes, ripper labels, gates, muxes, flip-flops, latches, constants, instances and black boxes.
- Design: symbols in the editor foreground, wires a step lighter, one accent (the theme link colour) for ports and junction dots, calm fills, rounded wire bends that stay sharp next to any dot or pin, labels in the editor's monospace font and titles in the UI font. Every value is a token in `webview/render/tokens.ts`. High contrast themes get 2 px borders and no fills.
- Legend button (key `l`): every symbol with its meaning, drawn with the diagram's own symbols.
- Focus mode: hover a wire or a symbol to light its whole net and fade everything else to 35 percent; a hovered element gets a soft accent glow; Escape clears.
- Readable layout: wires of different nets stay at least 8 px apart, fan-out trunks get their own channels, pins sit 16 px apart, junction dots are 2.5 times the wire width, at least 20 px from each other and 16 px from any plain crossing, and only ever mark a T (never a crossing, never a 4-way), join and split labels sit above their own slice wires. The accuracy suite checks all of this on every fixture in all three views, and a 100-node diagram renders in under 16 ms.
- Warnings on the wire: multiply driven bits (`y[3:2] has multiple drivers`; disjoint slice assigns are legal and draw as a join) and combinational loops carry a badge; the banner names the offending signal and bits.
- Every fixture is checked for functional equivalence against its source with Icarus Verilog in both views (`docs/ACCURACY_REPORT.md`).
- Hierarchy: instances of modules in the same file are boxes you can double-click to drill into, with a breadcrumb to go back. Modules that are not in the file (HDLBits' `mod_a`, `my_dff`, `add16`) are drawn as dashed black boxes with pin directions inferred from how they are connected.
- Linking: the editor cursor highlights the matching nodes and nets; clicking a node jumps to its source; the error banner jumps to the error line.
- Status badge: Structural or Editing (the text does not parse yet), RTL view / Gate view (green), Stale (amber: the last good diagram with the changed ports overlaid), plus the backend name and version; hover the badge for what it means. The error banner has one "Go to line N" button.
- Syntax errors say what is missing and where, including at the end of the file (`missing ';'`, `missing ')' to close the port list`, `missing endmodule`); Verilator sharpens the message when it is installed. Ports recovered from a broken header stay visible, greyed.
- Untitled files in Verilog mode render; untitled Plain Text that looks like Verilog gets a one-click "Set language to Verilog".
- Export SVG and PNG (2x): dark lines on white with a 24 px margin and safe fonts by default, so the file looks finished in a document; set `rtlLive.exportPalette` to `theme` to keep the editor colours. "Open in editor panel" shows the same diagram in a full editor tab.
- Keys inside the view: `f` fit, `+`/`-` zoom, `l` legend, `Escape` clear focus or close the legend, `Backspace` drill up.
- Fully offline: no network, no telemetry.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `rtlLive.synthesisBackend` | `auto` | `auto` uses native yosys when `yosys -V` works, else the bundled wasm engine; `native`, `wasm`, or `off` (structural view only). |
| `rtlLive.yosysPath` | `""` | Path to a native yosys binary. Empty searches `/opt/homebrew/bin`, `/usr/local/bin` and `PATH`. |
| `rtlLive.yosysExtraPasses` | `""` | Extra passes inserted before `write_json`, separated by semicolons. |
| `rtlLive.optimize` | `false` | Runs `opt -fast` before writing the netlist (smaller diagram, further from the source text). |
| `rtlLive.bubbles` | `true` | Draw a NOT that feeds a single gate as an inversion bubble on that gate. |
| `rtlLive.structuralDebounceMs` | `60` | Delay between a keystroke and the structural update. |
| `rtlLive.synthDebounceMs` | `300` | Delay after the last keystroke before synthesis runs. |
| `rtlLive.exportPalette` | `print` | Colours of exported files: `print` is dark lines on white with a 24 px margin; `theme` keeps the editor colours. |
| `rtlLive.lintWithVerilator` | `true` | When the file does not parse or synthesis fails and `verilator` is on PATH, run `verilator --lint-only` to sharpen the error message. |

Settings apply live.

## Troubleshooting

- "Warming up synthesis engine" stays for a long time: the wasm engine loads about 80 MB on first use. Check "RTL Live: Show Log". `brew install yosys` makes synthesis native and faster.
- The badge says Stale: the file has a syntax error (banner shows the first one) or synthesis has not caught up yet. The last good diagram stays on screen.
- Nothing appears: the file must end in `.v`, `.vh`, `.sv` or `.svh`, or have the Verilog or SystemVerilog language mode. Files above 2,000 synthesized nodes show the structural view only.
- The view is blank (no toolbar): run "RTL Live: Show Log". A healthy start logs `sidebar webview script ...`, `[webview] webview booting (vscode api)` and `sidebar webview ready`. A missing `webview booting` line means the HTML never ran; a `failed to load ...` or `uncaught ...` line names the broken resource. "Developer: Open Webview Developer Tools" shows the same errors in a console.
- The log says `tree-sitter grammar unavailable ... using fallback scanner`: the bundled parser did not load and the regex scanner is drawing the structural view. The first 0.1.0 vsix had this bug (fixed; `npm run test:packaged` guards it).
- A dashed box labelled with a `$...` cell type: a Yosys cell this version does not know how to draw yet; it is logged once in the output channel.
- Layout looks wrong after a theme change: run "RTL Live: Fit to View" (or press `f` in the view).

## Architecture

```
editor text --(60 ms)--> structural layer (web-tree-sitter + tree-sitter-verilog wasm,
                          fallback scanner) --> IR (structural) --> webview
            --(300 ms, clean tree only)--> synthesis layer (native yosys or @yowasp/yosys
                          in a worker_threads worker, one script per view) --> write_json --> fromYosys
                          --> rtlView (RTL view only) --> simplify --> semantics --> IR --> webview
webview: IR --> ELK (layered, Web Worker from a Blob URL) --> SVG symbols, d3-zoom
```

- `src/structural/`: error-tolerant parsers that share one `StructuralFile` model; `toIr.ts` builds the structural IR.
- `src/synth/`: Yosys script, black-box stubs, native and wasm backends, the worker entry.
- `src/ir/`: shared IR types, `fromYosys.ts` (bit-level net reconstruction with split/join/const nodes), `rtlView.ts` (case muxes by select value), `simplify.ts` (gate chain merging, buffer removal, inversion bubbles), `semantics.ts` (multiple drivers, combinational loops), `overlay.ts` (stale port overlay), `toVerilog.ts` (netlist export for the equivalence check), stable ids.
- `src/extension/`: scheduler with per-document generations, synthesis manager with an LRU cache, controller, webview provider with a strict CSP.
- `webview/`: layout (`toElk.ts`), SVG renderer and symbols, zoom, cursor highlight, export, toolbar/status/banner/breadcrumb.

See NOTES.md for decisions, measurements and known issues.

## Development

```
npm install            # npm 12 was needed on this machine, see NOTES.md
npm run build:grammar  # builds assets/wasm/tree-sitter-verilog.wasm (needs network once)
npm run build
npm test               # vitest unit + golden (uses the wasm yosys)
npm run test:integration
npm run test:webview   # playwright; also writes artifacts/contact-sheet.png and the layout shots
npm run test:packaged  # packages a vsix and runs the integration suite against the unzipped copy
npm run test:accuracy:update  # rewrite the accuracy baseline after an intended change (review the diff)
npm run test:perf      # render budget: a 100-node diagram in under 16 ms (runs alone, timing)
npm run test:mutation  # Stryker: how many injected bugs the suites catch (hours; reports in artifacts/mutation/)
npm run bench
npm run package        # rtl-live-<version>.vsix
```

## Future work

Simulation and waveforms, SystemVerilog-only constructs (interfaces, packages), complex generate loops, memories beyond a `$mem` box, multi-file projects, VHDL, technology mapping, graphical editing and Marketplace publishing are out of scope for v1.

## Credits

Yosys and YoWASP (ISC), web-tree-sitter and tree-sitter-verilog (MIT), elkjs (EPL-2.0), d3 (ISC), codicons (CC-BY-4.0). The split/join net reconstruction follows the approach of netlistsvg (MIT). See THIRD_PARTY_NOTICES.md.

## License

MIT
