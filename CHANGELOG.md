# Changelog

## 0.4.1

Three small fixes from docs/BUGS.md (items 21 to 23).

- A module with ports but no logic is drawn as a box again. Yosys tags an empty body as a blackbox and the netlist reader skipped it, so the panel showed "Open a Verilog file" under a "synthesized" badge. Every output nothing drives now carries a small "not driven yet" hint beside its chevron (synthesized and structural views), and the empty state only claims no file is open when none is.
- A lone `assign` (or `assign y` with no `=`) is reported first, in beginner terms: "assign is incomplete: write assign name = expression;". The banner lists the errors after the first one on a second line, so "missing endmodule" still shows.
- Ports from a cleanly parsed header stay solid when the error is later in the file; only ports recovered from a broken header are ghosted.

## 0.4.0

Visual design release: calm, precise and readable, like a polished EDA tool or a textbook figure. Every value is a design token in `webview/render/tokens.ts`; the stylesheet repeats them on `:root` and a unit test keeps the two in step.

- Symbols in the editor foreground at 1.75 px, wires a step lighter (70 percent) at 1.25 px, buses 2.5 px, the module frame 1 px. One accent, the theme link colour, for ports and junction dots only; warning and error colours only for real warnings and errors; everything else greyscale.
- Gate and box bodies filled at 6 percent of the foreground, the module frame at 3 percent, dashed boxes (black boxes, logic clouds) unfilled. Node boxes have 6 px corners, port chevrons 4 px, muxes 3 px.
- Wire bends get a 4 px arc, except within 8 px of a junction dot or a pin, so a rounded corner never reads as a connection.
- Type: signal, port, pin and width labels in the editor's monospace font (11 px, 10 px for widths and slice ranges, muted); titles and operator glyphs in the UI sans at 12 px semibold.
- Hover lifts an element with a soft 2 px accent glow and changes no colour; focus mode fades everything outside the net to 35 percent; the editor cursor match takes the accent. Transitions are 150 ms and off under prefers-reduced-motion.
- High contrast themes: no fills, no glow, no shadows, 2 px borders in the theme's contrast colours.
- Toolbar: 22 px controls, codicons for fit, zoom and open-in-panel, RTL and Gate as one segmented control; badges, banner, hint, breadcrumb, Legend and the empty, loading, error and stale states restyled on the same tokens.
- Export: dark lines on white with a 24 px margin and safe font stacks by default, so the file looks finished outside VS Code; `rtlLive.exportPalette: "theme"` keeps the editor colours. PNG export sizes itself from the SVG.
- Performance: the junction post-pass that keeps dots 20 px apart was quadratic in the number of wires and took 2.3 s on a 100-node diagram; it now indexes segments and scores each slide by what it changes, and the same diagram renders in 13 ms. The renderer's crossing markers use the same index.
- Proof: `test/webview/v04.visual.spec.ts` renders every fixture in light and dark and the key fixtures plus the Legend in light, dark and high contrast; `scripts/v04-compare.mjs` writes before and after pairs. `test/webview/v04.hover.spec.ts` checks the hover glow, the focus fade, the high contrast rules and both export palettes. `npm run test:perf` holds the 16 ms render budget.

## 0.3.1

Two layout fixes from docs/BUGS.md (items 19 and 20).

- Fan-out hubs (bug 19): junction dots are at least 20 px apart and a plain crossing is at least 16 px from any junction dot. Node pins now sit at fixed positions one 16 px pitch apart (gate inputs included), the post-pass that splits 4-way junctions keeps its two dots 20 px apart, and a dot that crowds another dot or a crossing is slid along its trunk until it is clear. Both rules are L3 checks on every fixture in every view; the checker also now finds junction dots on bus wires, which it had missed before.
- Legend (bug 20): samples draw at the diagram's own scale (one SVG unit per pixel), each sample box includes the ripper range labels that hang beside the bar, and the picture column is wide enough for every sample, so `[5:3]` and `[2:0]` are the diagram's size, nothing is clipped, and nothing overlaps the text column. A unit test measures every sample and a Playwright test measures the rendered panel in light and dark.

## 0.3.0

Readability and clarity release for first-week Verilog learners. Every fixture passes the readability checks in all three views, including four new ones (wire spacing, label clearance, junction correctness, no 4-way junctions); see docs/ACCURACY_REPORT.md.

- Bit-accurate driver analysis: `assign y[5:3] = ...; assign y[2:0] = ...;` is legal and draws as one cloud per assign into a join; only bits written twice are reported, and the message names them (`y[3:2] has multiple drivers`).
- A port swallowed by a missing comma (`input p1c p1d`) stays visible as a greyed port with a `missing ','` message, and recovered ports keep their declaration order.
- Layout: wider wire channels and Brandes-Koepf placement (fewer crossings, no two nets closer than 8 px), junction dots 2.5 times the stroke, 4-way junctions split into two T junctions, join and split labels above their own slice wires at a 16 px pitch, width labels placed on the first spot clear of other wires and symbols.
- Logical operators drawn the way they work: `a || b` on buses goes through "any 1?" boxes into a 1-bit OR tagged "logical"; `!a` on a bus is one "all 0?" box.
- Every element has a plain-language tooltip (wires, buses, ports, gates, boxes, dots, crossings, bubbles, pins, slashes, ripper labels, badges) that quotes the source line it came from.
- Legend button (key `l`) listing every symbol with its meaning, drawn with the diagram's own symbols, theme aware.
- Focus mode: hovering a wire or symbol lights its whole net and dims the rest; Escape clears.
- Designed empty, loading, error and stale states: one sentence each, at most one button ("Go to line N").
- Status text in plain words; badges explain themselves on hover.
- `npm run test:webview` writes `artifacts/contact-sheet.png` with every fixture drawn small.

## 0.2.0

Accuracy, robustness and readability release. Every fixture passes the functional equivalence check (the diagram's netlist simulates like the source under Icarus) in both synthesized views; see docs/ACCURACY_REPORT.md.

- Two synthesized views with a toolbar toggle: RTL view (shaped like the source: one N:1 mux per `case` with inputs labelled by select value, enable flops with an EN pin, sync reset as an R pin, written comparators kept) and gate view (what synthesis builds: enables and resets as muxes in front of plain flops).
- Logical operators (`&&`, `||`, `!`) are drawn and exported differently from bitwise ones; NAND, NOR and XNOR chains become one symbol with an output bubble; `{N{...}}` replications are one join input.
- Syntax errors say what is missing (`missing ';'`, `missing ')' to close the port list`, `missing endmodule`, `missing operand after '&'`) at the right line and column, including at the end of the file; Verilator refines generic messages when installed. Ports recovered from a broken header stay visible, greyed.
- Editing rule: while the text does not parse, the last good diagram stays with the "Stale" badge and the changed ports overlaid; a never-synthesized file shows the structural view with an "Editing" badge.
- Latches carry a warning badge and no clock triangle; multiply driven nets and combinational loops are badged on the wire.
- The view follows the active editor after sleep and after a window switch (heartbeat, resync, active-editor re-read); a page that never loads is retried and then replaced by a failure page with a Reload Window action.
- Untitled files in Verilog mode render; untitled Plain Text that looks like Verilog gets a one-click "Set language to Verilog".
- Module titles fit their frame, Fit never zooms above 100 percent, ports line the edges even for a half-typed header, labels never overlap symbols or each other, bus width labels sit on the first clear wire.
- Tests run in throwaway VS Code profiles with fixture copies; new accuracy suite (functional, structural, readability) and `npm run test:packaged`.

## 0.1.0

First release. Rebuilt on 2026-10-22 with these fixes:

- The bundled web-tree-sitter grammar now loads in the installed extension. The first build bundled the ESM copy of web-tree-sitter, whose `import.meta.url` is empty in a cjs bundle, so every install silently used the fallback regex scanner.
- The webview reports boot progress, resource load failures, uncaught errors and unhandled rejections to the "RTL Live" output channel.
- New `npm run test:packaged` runs the integration suite against a freshly packaged vsix.

- Sidebar "Schematic" view with a strict CSP; works fully offline.
- Structural view updated on every keystroke (web-tree-sitter with tree-sitter-verilog, fallback scanner): module box, ports, wires, instances, logic clouds; tolerant to partial code.
- Synthesized view via Yosys: native binary or bundled wasm (`@yowasp/yosys`) in a worker thread with preloading, recycling, timeout and cancellation; LRU result cache.
- IEEE/ANSI gate symbols, reduction gates, muxes, flip-flops, arithmetic and comparator boxes, constants, split/join rippers for buses.
- Hierarchy with drill-down and breadcrumb; black-box stubs for undefined modules with inferred pin directions.
- Cursor-to-diagram and diagram-to-cursor linking, error banner with stale badge, theme support, 150 ms move tween, SVG/PNG export, editor panel.
