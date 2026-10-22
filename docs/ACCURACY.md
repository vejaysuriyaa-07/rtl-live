# RTL Live: diagram accuracy spec

What "accurate" means for this extension, the drawing conventions every schematic must follow, and the test cases that prove it.

## 1. Three levels of accuracy

| Level | Meaning | How it is checked |
| --- | --- | --- |
| L1 Functional | The drawn circuit computes exactly what the source code computes. Non-negotiable. | Automated equivalence test (section 6) |
| L2 Structural | The diagram is shaped like the code that was written. A 4-way `case` is a 4:1 mux, `a & b & c` is one 3-input AND, an `if (en)` on a flop is an enable flop. | Structural assertions per fixture + HDLBits figure comparison |
| L3 Readable | Labels fit, bus widths are shown, nothing overlaps, flow reads left to right. | Screenshot review + automated layout checks |

## 2. Two views

Synthesis rearranges logic. A single view cannot be both faithful to the code and optimized, so the extension offers two:

- **RTL view (default).** Shaped like the source. Word-level operators stay as single blocks (`+`, `==`, `<`), `case` becomes one N:1 mux, user names are kept, no constant folding that hides user logic (for example `state == B` stays a comparator).
- **Gate view.** The optimized netlist as Yosys produces it, for learning what synthesis actually builds.

A toggle in the toolbar switches between them. The status badge shows which view is active.

## 3. Symbol conventions

### Gates
- IEEE distinctive shapes: AND (D shape), OR (shield), XOR (shield with extra input curve), NOT (triangle with bubble), BUF (triangle).
- Inversion is a bubble: NAND, NOR, XNOR are drawn as AND, OR, XOR with an output bubble. An inverted input is an input bubble.
- N-input gates: one gate symbol with N input pins, never a chain of 2-input gates when the source wrote one expression.
- Reduction operators (`&x`, `|x`, `^x`): the matching gate shape with a single bus input and a width label.
- Logical operators (`&&`, `||`, `!`) must look different from bitwise ones. Draw each operand through a "nonzero" reducer (an OR-reduce marked `!=0`) before the 1-bit gate, or label the gate `||` / `&&`. A learner must be able to tell `a | b` from `a || b` at a glance.

### Multiplexers
- Trapezoid, wide side toward the data inputs, narrow side toward the output.
- Data inputs are labelled with their select value: `0`, `1` for a 2:1 mux; `0`, `1`, `2`, `3` for a 4:1 mux. The input chosen when select is 0 is the one labelled `0`.
- Select enters on the bottom edge and is labelled with its width when it is a bus.
- `cond ? x : y` is a 2:1 mux with `y` on input `0` and `x` on input `1`.
- A `case` on one selector with constant labels is one N:1 mux. A `default` branch fills the remaining inputs.

### Sequential elements
- **Edge-triggered flip-flop:** box with `D` on the left, `Q` on the right, clock on the bottom drawn with a triangle. A falling-edge flop has a bubble before the triangle.
- **Latch:** same box with **no triangle** on the clock (level sensitive). A negative latch has a bubble on its clock pin. Latches always carry a warning badge, since an inferred latch is usually a bug in RTL.
- **Enable flop:** a flop with an `EN` pin in RTL view. In gate view it is a 2:1 mux in front of `D`, with `Q` fed back to input `0` and `en` on select.
- **Scan flop (mux-D flop):** a 2:1 mux in front of `D`, with functional data on `0`, scan-in on `1`, scan-enable on select.
- **Reset:** synchronous reset is drawn as a mux to the reset value (gate view) or an `R` pin marked "sync" (RTL view). Asynchronous reset is an `R` pin on the flop marked "async".
- Multi-bit registers are one flop box with bus `D`/`Q` and a width label, not N separate flops.

### Arithmetic and datapath
- Word-level `+`, `-`, `*` are one box with the operator glyph. Output width is shown (an 8-bit `+` with a 9-bit result shows `9`).
- Comparators (`==`, `!=`, `<`, `<=`, `>`, `>=`) are one box with the operator glyph and a 1-bit output.
- A ripple carry adder built from full-adder instances reads left to right from LSB to MSB, carry-in entering the LSB cell, carry-out leaving the MSB cell, carries labelled `c1`, `c2`, ... between cells.
- Shifts by a constant are pure wiring (rippers), not a shifter block. Shifts by a variable amount are a shifter box.

### Wires and buses
- Any net wider than 1 bit is drawn thicker with a slash and its width.
- Bit and part selects are rippers labelled with the range (`[7:0]`, `[15:8]`).
- Constants are small pills with their Verilog literal (`1'b0`, `4'd5`).
- Fan-out is drawn as a junction dot where one wire splits.
- User-declared net names are shown on the wire (or on hover when space is tight). Auto-generated names are never shown.

### Hierarchy
- Instances are boxes titled `instance : module`, inputs on the left, outputs on the right, pin names inside the box.
- Undefined modules (black boxes) are dashed, with the tooltip "not defined in this file".
- Double-click opens the instance; a breadcrumb returns to the parent.

## 4. Layout and readability rules

- Signal flow is left to right. Inputs on the left edge, outputs on the right edge, clocks and selects enter from below.
- Every box grows to fit its label. Labels are never clipped or overflow their box.
- Text size stays readable at every zoom level. "Fit" never zooms a tiny diagram above 100%.
- No wire crosses through a symbol. No two labels overlap.
- Layout is stable across edits: unchanged parts of the circuit do not jump around.
- Error states: when the newest edit does not parse, the badge and the drawing must agree. Either keep the last good diagram with the "Stale" badge, or show the live structural view with an "Editing" badge, never one with the other.
- Error messages point at the real location and say what is missing, for example `missing ');' to close the port list`, `missing endmodule`.
- The view follows the active editor and keeps working after the machine sleeps.

## 5. Test cases

Each case lists the source, what must appear (L2), and the reference. HDLBits cases are compared with the figure on the HDLBits problem page.

### 5.1 HDLBits cases (existing fixtures)

| Fixture | Must show | Reference |
| --- | --- | --- |
| `7458.v` | Two 2-input ANDs, two 3-input ANDs, two ORs, nets w1..w4 | HDLBits 7458 figure |
| `vector0.v` | 3-bit bus labelled `3`, ripped into 3 single wires | HDLBits vector0 figure |
| `vectorgates.v` | 3-bit bitwise OR, a visibly different logical OR, two 3-bit NOTs joined into a 6-bit bus | HDLBits vectorgates figure |
| `gates4.v` | Three reduction gates, 4-bit input, 1-bit outputs | HDLBits gates4 |
| `vector2.v` | Four byte slices crossing, rippers `[7:0]` to `[31:24]` | HDLBits vector2 |
| `module_shift.v` | Three flop instances in a chain, clk fanning out to all three | HDLBits module_shift figure |
| `module_shift8.v` | Three 8-bit flop instances, then one 4:1 mux with inputs `0 1 2 3` and a 2-bit `sel` | HDLBits module_shift8 figure |
| `module_add.v` | Two `add16` boxes, carry wire between them, `1'b0` on the first carry-in | HDLBits module_add figure |
| `counter4.v` | One 4-bit register, an adder feeding back from `Q`, reset to 0 | HDLBits count15 |
| `fsm_moore.v` | One state register, next-state mux logic, output logic from state | HDLBits fsm1 |

### 5.2 Datapath cases (new fixtures, standard textbook circuits)

```verilog
// rca4.v: ripple carry adder from full adders
module fa(input a, b, cin, output s, cout);
  assign s    = a ^ b ^ cin;
  assign cout = (a & b) | (a & cin) | (b & cin);
endmodule
module top_module(input [3:0] a, b, input cin, output [3:0] s, output cout);
  wire c1, c2, c3;
  fa f0(a[0], b[0], cin, s[0], c1);
  fa f1(a[1], b[1], c1,  s[1], c2);
  fa f2(a[2], b[2], c2,  s[2], c3);
  fa f3(a[3], b[3], c3,  s[3], cout);
endmodule
```
Must show: four `fa` boxes in a row, LSB on the left, carry chain `cin -> c1 -> c2 -> c3 -> cout`. Inside `fa`: one 3-input XOR for `s`, three 2-input ANDs into one 3-input OR for `cout` (majority).

```verilog
// mux4_case.v: 4:1 mux from a case statement
module top_module(input [7:0] d0, d1, d2, d3, input [1:0] sel, output reg [7:0] y);
  always @(*)
    case (sel)
      2'd0: y = d0;
      2'd1: y = d1;
      2'd2: y = d2;
      default: y = d3;
    endcase
endmodule
```
Must show (RTL view): one 4:1 mux, inputs `0 1 2 3` from d0..d3, 2-bit select, 8-bit output. No latch.

```verilog
// en_flop.v: enable flop
module top_module(input clk, en, d, output reg q);
  always @(posedge clk)
    if (en) q <= d;
endmodule
```
Must show: RTL view, a flop with an `EN` pin. Gate view, a 2:1 mux with `Q` fed back to input `0`. Never a latch.

```verilog
// scan_flop.v: mux-D scan flop
module top_module(input clk, d, si, se, output reg q);
  always @(posedge clk)
    q <= se ? si : d;
endmodule
```
Must show: a 2:1 mux (input `0` = d, input `1` = si, select = se) feeding the flop `D`.

```verilog
// latch_vs_flop.v
module top_module(input clk, d, output reg q_latch, output reg q_flop);
  always @(*)
    if (clk) q_latch = d;
  always @(posedge clk)
    q_flop <= d;
endmodule
```
Must show: a latch (no clock triangle, warning badge) and a flop (clock triangle), side by side.

```verilog
// counter8_reset.v: 8-bit counter with synchronous reset
module top_module(input clk, reset, output reg [7:0] q);
  always @(posedge clk)
    if (reset) q <= 8'd0;
    else       q <= q + 8'd1;
endmodule
```
Must show: one 8-bit register, a `+1` incrementer fed back from `Q`, reset forcing `0` (mux or sync `R` pin).

```verilog
// compare4.v: magnitude comparator
module top_module(input [3:0] a, b, output gt, eq, lt);
  assign gt = a > b;
  assign eq = a == b;
  assign lt = a < b;
endmodule
```
Must show: three comparator boxes labelled `>`, `==`, `<`, each with two 4-bit inputs and a 1-bit output.

```verilog
// bitwise_vs_logical.v
module top_module(input [2:0] a, b, output [2:0] bw, output lg, output nb, output nl);
  assign bw = a | b;
  assign lg = a || b;
  assign nb = ~a[0];
  assign nl = !a;
endmodule
```
Must show: `bw` a 3-bit OR; `lg` visibly different from `bw`; `nb` a NOT on one bit; `nl` visibly different from `nb`.

```verilog
// inverted_gates.v
module top_module(input a, b, output y_nand, y_nor, y_xnor);
  assign y_nand = ~(a & b);
  assign y_nor  = ~(a | b);
  assign y_xnor = ~(a ^ b);
endmodule
```
Must show: one NAND, one NOR, one XNOR symbol, each with an output bubble, no separate NOT gates.

### 5.3 Editing cases (partial code)

| Input | Must show |
| --- | --- |
| `module top_module(` | A module box whose title fits inside it, badge "Editing" (or the last good diagram with "Stale", consistently) |
| `module top_module(input a, output b` | Box with port `a` left and `b` right |
| Valid module, then delete `endmodule` | Error banner `missing endmodule` at the end of the file, badge and drawing consistent |
| Switch to another `.v` tab | Diagram switches to that file within 500 ms |
| Machine sleeps overnight, then switch tabs | Diagram still follows the active editor without a reload |

## 6. Automated checks

1. **Functional equivalence (L1).** For every fixture, write the extension's internal graph back out as a structural Verilog netlist, simulate it and the original source with Icarus Verilog on the same random input vectors (and clock cycles for sequential fixtures), and require identical outputs. Any mismatch fails the build.
2. **Structural assertions (L2).** Each fixture has an expected JSON listing node kinds, counts, widths, mux input labels, flop pins and named nets, checked in both RTL and gate view where they differ.
3. **Layout checks (L3).** Automated tests assert that no label's bounding box exceeds its symbol or overlaps another label, every bus has a width label, and "Fit" zoom is at most 100% for small diagrams.
4. **Golden screenshots.** Light and dark screenshots per fixture, reviewed by a person once, then compared on every change.

## 7. Manual review checklist

For each fixture, open it next to its reference and tick:

- [ ] Same gates and blocks as the reference, same count
- [ ] Mux inputs labelled with select values, select on the bottom
- [ ] Flops have clock triangles, latches do not and carry a warning
- [ ] Bus widths shown, rippers labelled
- [ ] All labels fit, nothing overlaps
- [ ] Hover shows the right source line, click jumps there
- [ ] Badge matches what is drawn

## 8. Sources for conventions

- HDLBits problem figures (hdlbits.01xz.net) for the HDLBits cases.
- Standard CMOS VLSI textbook notation for gate symbols, the flip-flop clock triangle versus the latch, enable and scan flops, mux input labelling, and the ripple carry adder layout.
