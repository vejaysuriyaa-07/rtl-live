# RTL Live: bug hunt, visual polish and roadmap

Part A is a checklist to run by hand. Every finding goes into BUGS.md as one line: what you typed, what you expected, what you saw.

## Part A: bug hunt checklist

Work in a scratch folder outside the repo (for example `~/hdlbits/recall/`). One file per experiment.

### A1. Live typing and parsing

- [ ] Commented-out code (`// assign y = a;` and `/* ... */` across lines) draws nothing
- [ ] Non-ANSI header: `module m(a, b); input a; output b; assign b = a; endmodule`
- [ ] Two modules in one file, neither named `top_module`: is the right top picked, and can you switch?
- [ ] Parameterized widths: `parameter N = 8;` and `input [N-1:0] a`: width shows 8
- [ ] `` `define WIDTH 8 `` used in a port: graceful result, not a crash
- [ ] Delete one `;` in the middle of a valid file: the rest of the diagram survives
- [ ] Paste a whole file at once, then Cmd+Z twenty times fast: no stuck or stale diagram
- [ ] Empty file, and a file with only comments: clear empty state
- [ ] Windows line endings (CRLF) and tabs: hover and click-to-source still land on the right line and column
- [ ] Big-endian vector `[0:7]`, 1-bit vector `[0:0]`, wide vector `[127:0]`, `signed` ports

### A2. Semantics (does the drawing match what the hardware really is)

- [ ] Two `assign`s to the same wire: shown as an error (multiple drivers), not silently drawn
- [ ] Output never assigned: marked undriven. Input never used: marked unused
- [ ] Combinational loop `assign a = ~a;`: warning
- [ ] Incomplete `if` in `always @(*)`: latch symbol plus warning
- [ ] `case` with and without `default`: no latch only when every case is covered
- [ ] Shift register written with `<=` versus `=` in `always @(posedge clk)`: these build different hardware and must draw differently
- [ ] Async reset `always @(posedge clk or posedge rst)`: `R` pin marked async
- [ ] Priority `if / else if / else` chain: a chain of 2:1 muxes in priority order
- [ ] `casez` with `?` wildcards
- [ ] Tri-state `assign y = en ? a : 1'bz;`
- [ ] `{cout, sum} = a + b;` concatenation on the left side
- [ ] Width mismatch `assign y8 = a4 + b4;`: result width shown correctly
- [ ] `generate for` loop creating 4 instances
- [ ] Memory `reg [7:0] mem [0:15];` with a read and a write
- [ ] A `function` used in an `assign`

### A3. Layout and visuals

- [ ] Two wires crossing without connecting are clearly different from a junction (junction dot only where connected)
- [ ] Signal names 30+ characters long: boxes grow, nothing clipped
- [ ] 50+ gates: still readable, pan and zoom smooth, no overlapping wires
- [ ] One clock driving 20 flops: fan-out is clean, not a hairball
- [ ] Feedback loops (counter, FSM): the backward wire is readable
- [ ] Light, dark and high-contrast themes; VS Code zoom (Cmd + and Cmd -); a very narrow sidebar; a large external monitor

### A4. Interaction

- [ ] Hover and click-to-source on a multi-line expression
- [ ] Cursor highlight on every kind of element (port, gate, mux, flop, instance, constant)
- [ ] Three-level hierarchy: drill down twice, breadcrumb back up
- [ ] Exported SVG opens correctly in a browser; exported PNG is sharp
- [ ] Sidebar and pop-out panel open at the same time stay in sync

### A5. Lifecycle and environment

- [ ] Mac sleeps with VS Code open, then wake and switch tabs (bug 4)
- [ ] Open a second VS Code window (bug 11)
- [ ] Switch between five `.v` tabs quickly
- [ ] Two `.v` files side by side in split editors: which one is drawn?
- [ ] Rename a file, delete a file that is open, open a file outside any folder
- [ ] Untitled file set to Verilog (bug 9)
- [ ] Setting `rtlLive.synthesisBackend` to `wasm`: same diagrams as native
- [ ] Only one VS Code version running at a time (bugs 11 and 12)

### A6. Performance

- [ ] A 500-line design: typing still feels instant
- [ ] After an hour of use: memory of the VS Code helper processes in Activity Monitor stays stable

## Part B: visual polish spec

The goal is a schematic that looks like it came from a professional EDA tool: calm, precise, readable.

### Lines
- Single-bit wires 1.5 px, buses 3 px, symbol outlines 1.5 px. The same weights everywhere.
- Orthogonal routing with sharp corners, aligned to a grid.
- Junction dot only at a T where wires connect. Never a 4-way junction (offset one branch). A plain crossing has no dot and means "not connected."
- Even spacing between parallel wires; no two wires share a segment.

### Color
- Neutral foreground for everything by default. Color carries meaning only:
  - accent color for the selected element and its connected net
  - a distinct color (or dashed style) for clock nets, another for reset nets
  - error color for errors, warning color for latches and undriven or unused signals
- Every color comes from the active VS Code theme, so light, dark and high contrast all look native.

### Text
- Monospace for signal and port names, sans-serif for module titles.
- Fixed sizes (11 to 13 px at 100% zoom). Fit never zooms past 100%.
- Bus widths in a smaller, muted label next to the slash.

### Symbols
- IEEE distinctive-shape gates drawn with clean geometry and consistent proportions.
- Input ports as right-pointing pentagons, outputs as left-pointing, inouts as hexagons.
- Mux trapezoids, flop boxes with a clock triangle, and instance boxes share one corner radius.

### Motion and states
- 150 ms ease when nodes move, off when the system asks for reduced motion.
- Hover a wire: the whole net highlights, everything else dims slightly ("focus mode").
- Designed empty, loading, error and stale states: one clear sentence and, where it helps, one action button.
- Minimap in a corner for diagrams larger than the view.

### Export
- SVG and PNG on a white background with dark lines for printing and documents, regardless of the current theme (option to keep theme colors).

## Part C: roadmap of pro features

Modeled on what professional RTL viewers and debuggers offer.

1. **RTL view and gate view toggle.** An elaborated view shaped like the code, and an optimized view (see ACCURACY.md).
2. **Trace drivers and loads.** Right-click a wire: highlight what drives it, or everything it feeds.
3. **Fan-in and fan-out cones.** Show only the logic feeding a chosen signal, or only what it affects.
4. **Path between two points.** Pick a start and end; show only the logic in between.
5. **Search.** Type a signal or instance name to find and zoom to it.
6. **Design stats.** Cell counts by type, flop count, and the longest combinational path in logic levels (a quick view of logic depth).
7. **Simulation values on wires (v2).** Load a VCD from Icarus, step through time, and color each wire by its value, synced with a waveform strip and the code.
