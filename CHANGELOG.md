# Changelog

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
