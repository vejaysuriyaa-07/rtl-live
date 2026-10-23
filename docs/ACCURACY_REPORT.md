# Accuracy report

Generated 2026-10-23 by `npm test` (test/accuracy) from 44 fixtures in test/fixtures/hdlbits.

Levels:

- L1 functional: the netlist exported from the diagram (src/ir/toVerilog.ts) simulates identically to the source under Icarus Verilog on random vectors (clocked designs cycle by cycle). Bits that are x or z on either side are skipped and counted.
- L2 structural: the assertions in test/fixtures/expected/<fixture>.json hold (ports and structural counts for the structural view; node, net, pin and width assertions in the rtl and gate blocks for the two synthesized views).
- n/a: the gate view is asserted only where it differs from the RTL view (ACCURACY.md 6.2).
- L3 readable: labels fit their symbols, no two labels overlap, every bus has a width label, Fit stays at or below 100 percent, no wire crosses a symbol, parallel wires of different nets are at least 8 px apart, wire labels keep clear of other nets, and every junction dot marks a real T of its own net (none on a plain crossing, no 4-way junctions, dot radius at least 2.5 times the stroke).

## Summary

| view | L1 | L2 | L3 |
| --- | --- | --- | --- |
| structural | 4/44 | 44/44 | 44/44 |
| rtl | 44/44 | 44/44 | 44/44 |
| gate | 44/44 | 5/5 | 44/44 |

## Per fixture

| fixture | view | L1 | L2 | L3 |
| --- | --- | --- | --- | --- |
| 7458.v | structural | FAIL | pass | pass |
| 7458.v | rtl | pass | pass | pass |
| 7458.v | gate | pass | pass | pass |
| arith_compare.v | structural | FAIL | pass | pass |
| arith_compare.v | rtl | pass | pass | pass |
| arith_compare.v | gate | pass | n/a | pass |
| bitwise_vs_logical.v | structural | FAIL | pass | pass |
| bitwise_vs_logical.v | rtl | pass | pass | pass |
| bitwise_vs_logical.v | gate | pass | n/a | pass |
| case_mux.v | structural | FAIL | pass | pass |
| case_mux.v | rtl | pass | pass | pass |
| case_mux.v | gate | pass | n/a | pass |
| compare4.v | structural | FAIL | pass | pass |
| compare4.v | rtl | pass | pass | pass |
| compare4.v | gate | pass | n/a | pass |
| counter4.v | structural | FAIL | pass | pass |
| counter4.v | rtl | pass | pass | pass |
| counter4.v | gate | pass | n/a | pass |
| counter8_reset.v | structural | FAIL | pass | pass |
| counter8_reset.v | rtl | pass | pass | pass |
| counter8_reset.v | gate | pass | pass | pass |
| dff_async.v | structural | FAIL | pass | pass |
| dff_async.v | rtl | pass | pass | pass |
| dff_async.v | gate | pass | n/a | pass |
| dff_enable.v | structural | FAIL | pass | pass |
| dff_enable.v | rtl | pass | pass | pass |
| dff_enable.v | gate | pass | n/a | pass |
| dff_sync_reset_en.v | structural | FAIL | pass | pass |
| dff_sync_reset_en.v | rtl | pass | pass | pass |
| dff_sync_reset_en.v | gate | pass | n/a | pass |
| en_flop.v | structural | FAIL | pass | pass |
| en_flop.v | rtl | pass | pass | pass |
| en_flop.v | gate | pass | pass | pass |
| fsm_moore.v | structural | FAIL | pass | pass |
| fsm_moore.v | rtl | pass | pass | pass |
| fsm_moore.v | gate | pass | pass | pass |
| gates4.v | structural | FAIL | pass | pass |
| gates4.v | rtl | pass | pass | pass |
| gates4.v | gate | pass | n/a | pass |
| inverted_gates.v | structural | FAIL | pass | pass |
| inverted_gates.v | rtl | pass | pass | pass |
| inverted_gates.v | gate | pass | n/a | pass |
| latch_en.v | structural | FAIL | pass | pass |
| latch_en.v | rtl | pass | pass | pass |
| latch_en.v | gate | pass | n/a | pass |
| latch_vs_flop.v | structural | FAIL | pass | pass |
| latch_vs_flop.v | rtl | pass | pass | pass |
| latch_vs_flop.v | gate | pass | n/a | pass |
| logic_ops.v | structural | FAIL | pass | pass |
| logic_ops.v | rtl | pass | pass | pass |
| logic_ops.v | gate | pass | n/a | pass |
| module_add_full.v | structural | FAIL | pass | pass |
| module_add_full.v | rtl | pass | pass | pass |
| module_add_full.v | gate | pass | n/a | pass |
| module_add.v | structural | FAIL | pass | pass |
| module_add.v | rtl | pass | pass | pass |
| module_add.v | gate | pass | n/a | pass |
| module_name.v | structural | pass | pass | pass |
| module_name.v | rtl | pass | pass | pass |
| module_name.v | gate | pass | n/a | pass |
| module_pos.v | structural | pass | pass | pass |
| module_pos.v | rtl | pass | pass | pass |
| module_pos.v | gate | pass | n/a | pass |
| module_shift.v | structural | pass | pass | pass |
| module_shift.v | rtl | pass | pass | pass |
| module_shift.v | gate | pass | n/a | pass |
| module_shift8.v | structural | FAIL | pass | pass |
| module_shift8.v | rtl | pass | pass | pass |
| module_shift8.v | gate | pass | n/a | pass |
| module.v | structural | pass | pass | pass |
| module.v | rtl | pass | pass | pass |
| module.v | gate | pass | n/a | pass |
| multi_module.v | structural | FAIL | pass | pass |
| multi_module.v | rtl | pass | pass | pass |
| multi_module.v | gate | pass | n/a | pass |
| mux2_always.v | structural | FAIL | pass | pass |
| mux2_always.v | rtl | pass | pass | pass |
| mux2_always.v | gate | pass | n/a | pass |
| mux4_case.v | structural | FAIL | pass | pass |
| mux4_case.v | rtl | pass | pass | pass |
| mux4_case.v | gate | pass | n/a | pass |
| nand_nor.v | structural | FAIL | pass | pass |
| nand_nor.v | rtl | pass | pass | pass |
| nand_nor.v | gate | pass | pass | pass |
| notgate.v | structural | FAIL | pass | pass |
| notgate.v | rtl | pass | pass | pass |
| notgate.v | gate | pass | n/a | pass |
| rca4.v | structural | FAIL | pass | pass |
| rca4.v | rtl | pass | pass | pass |
| rca4.v | gate | pass | n/a | pass |
| scan_flop.v | structural | FAIL | pass | pass |
| scan_flop.v | rtl | pass | pass | pass |
| scan_flop.v | gate | pass | n/a | pass |
| shift4.v | structural | FAIL | pass | pass |
| shift4.v | rtl | pass | pass | pass |
| shift4.v | gate | pass | n/a | pass |
| ternary.v | structural | FAIL | pass | pass |
| ternary.v | rtl | pass | pass | pass |
| ternary.v | gate | pass | n/a | pass |
| vector0.v | structural | FAIL | pass | pass |
| vector0.v | rtl | pass | pass | pass |
| vector0.v | gate | pass | n/a | pass |
| vector2.v | structural | FAIL | pass | pass |
| vector2.v | rtl | pass | pass | pass |
| vector2.v | gate | pass | n/a | pass |
| vector3.v | structural | FAIL | pass | pass |
| vector3.v | rtl | pass | pass | pass |
| vector3.v | gate | pass | n/a | pass |
| vector4.v | structural | FAIL | pass | pass |
| vector4.v | rtl | pass | pass | pass |
| vector4.v | gate | pass | n/a | pass |
| vector5.v | structural | FAIL | pass | pass |
| vector5.v | rtl | pass | pass | pass |
| vector5.v | gate | pass | n/a | pass |
| vectorgates_slices.v | structural | FAIL | pass | pass |
| vectorgates_slices.v | rtl | pass | pass | pass |
| vectorgates_slices.v | gate | pass | n/a | pass |
| vectorgates.v | structural | FAIL | pass | pass |
| vectorgates.v | rtl | pass | pass | pass |
| vectorgates.v | gate | pass | n/a | pass |
| vectorr.v | structural | FAIL | pass | pass |
| vectorr.v | rtl | pass | pass | pass |
| vectorr.v | gate | pass | n/a | pass |
| wire.v | structural | FAIL | pass | pass |
| wire.v | rtl | pass | pass | pass |
| wire.v | gate | pass | n/a | pass |
| wire4.v | structural | FAIL | pass | pass |
| wire4.v | rtl | pass | pass | pass |
| wire4.v | gate | pass | n/a | pass |
| xnor_misc.v | structural | FAIL | pass | pass |
| xnor_misc.v | rtl | pass | pass | pass |
| xnor_misc.v | gate | pass | n/a | pass |

## Failure reasons

- 7458.v, structural view, L1: not exportable: logic cloud "w1 = p2a & p2b" has no netlist semantics (cloud:assign:w1)
- arith_compare.v, structural view, L1: not exportable: logic cloud "sum = a + b" has no netlist semantics (cloud:assign:sum)
- bitwise_vs_logical.v, structural view, L1: not exportable: logic cloud "bw = a | b" has no netlist semantics (cloud:assign:bw)
- case_mux.v, structural view, L1: not exportable: logic cloud "always @(*): y" has no netlist semantics (cloud:always:y)
- compare4.v, structural view, L1: not exportable: logic cloud "gt = a > b" has no netlist semantics (cloud:assign:gt)
- counter4.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- counter8_reset.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- dff_async.v, structural view, L1: not exportable: logic cloud "always @(posedge clk or posedge are…" has no netlist semantics (cloud:always:q)
- dff_enable.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- dff_sync_reset_en.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- en_flop.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- fsm_moore.v, structural view, L1: not exportable: logic cloud "out = (state == B)" has no netlist semantics (cloud:assign:out)
- gates4.v, structural view, L1: not exportable: logic cloud "out_and = &in" has no netlist semantics (cloud:assign:out_and)
- inverted_gates.v, structural view, L1: not exportable: logic cloud "y_nand = ~(a & b)" has no netlist semantics (cloud:assign:y_nand)
- latch_en.v, structural view, L1: not exportable: logic cloud "always @(*): q" has no netlist semantics (cloud:always:q)
- latch_vs_flop.v, structural view, L1: not exportable: logic cloud "always @(*): q_latch" has no netlist semantics (cloud:always:q_latch)
- logic_ops.v, structural view, L1: not exportable: logic cloud "y_and = a && b" has no netlist semantics (cloud:assign:y_and)
- module_add_full.v, structural view, L1: not exportable: logic cloud "{cout, sum} = a + b + cin" has no netlist semantics (cloud:assign:cout,sum)
- module_add.v, structural view, L1: not exportable: logic cloud "a[15:0]" has no netlist semantics (cloud:expr:lo.a)
- module_shift8.v, structural view, L1: not exportable: logic cloud "always @(*): q" has no netlist semantics (cloud:always:q)
- multi_module.v, structural view, L1: not exportable: logic cloud "y = ~x" has no netlist semantics (cloud:assign:y)
- mux2_always.v, structural view, L1: not exportable: logic cloud "out_assign = (sel_b1 & sel_…" has no netlist semantics (cloud:assign:out_assign)
- mux4_case.v, structural view, L1: not exportable: logic cloud "always @(*): y" has no netlist semantics (cloud:always:y)
- nand_nor.v, structural view, L1: not exportable: logic cloud "y1 = ~(a & b & c)" has no netlist semantics (cloud:assign:y1)
- notgate.v, structural view, L1: not exportable: logic cloud "out = ~in" has no netlist semantics (cloud:assign:out)
- rca4.v, structural view, L1: not exportable: logic cloud "s = a ^ b ^ cin" has no netlist semantics (cloud:assign:s)
- scan_flop.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- shift4.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): sr" has no netlist semantics (cloud:always:sr)
- ternary.v, structural view, L1: not exportable: logic cloud "y = s ? b : a" has no netlist semantics (cloud:assign:y)
- vector0.v, structural view, L1: not exportable: logic cloud "outv = vec" has no netlist semantics (cloud:assign:outv)
- vector2.v, structural view, L1: not exportable: logic cloud "out = {in[7:0], in[15:8], i…" has no netlist semantics (cloud:assign:out)
- vector3.v, structural view, L1: not exportable: logic cloud "{w, x, y, z} = {a, b, c, d,…" has no netlist semantics (cloud:assign:w,x,y,z)
- vector4.v, structural view, L1: not exportable: logic cloud "out = {{24{in[7]}}, in}" has no netlist semantics (cloud:assign:out)
- vector5.v, structural view, L1: not exportable: logic cloud "out = ~{{5{a}}, {5{b}}, {5{…" has no netlist semantics (cloud:assign:out)
- vectorgates_slices.v, structural view, L1: not exportable: logic cloud "out_or_bitwise = a | b" has no netlist semantics (cloud:assign:out_or_bitwise)
- vectorgates.v, structural view, L1: not exportable: logic cloud "out_or_bitwise = a | b" has no netlist semantics (cloud:assign:out_or_bitwise)
- vectorr.v, structural view, L1: not exportable: logic cloud "out = {in[0], in[1], in[2],…" has no netlist semantics (cloud:assign:out)
- wire.v, structural view, L1: not exportable: logic cloud "out = in" has no netlist semantics (cloud:assign:out)
- wire4.v, structural view, L1: not exportable: logic cloud "w = a" has no netlist semantics (cloud:assign:w)
- xnor_misc.v, structural view, L1: not exportable: logic cloud "y1 = ~(a ^ b)" has no netlist semantics (cloud:assign:y1)

