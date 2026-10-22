# Accuracy report

Generated 2026-10-22 by `npm test` (test/accuracy) from 34 fixtures in test/fixtures/hdlbits.

Levels:

- L1 functional: the netlist exported from the diagram (src/ir/toVerilog.ts) simulates identically to the source under Icarus Verilog on random vectors (clocked designs cycle by cycle). Bits that are x or z on either side are skipped and counted.
- L2 structural: the assertions in test/fixtures/expected/<fixture>.json hold (ports and structural counts for the structural view; node, net, pin and width assertions for the gate view).
- L3 readable: labels fit their symbols, no two labels overlap, every bus has a width label, Fit stays at or below 100 percent, no wire crosses a symbol.

## Summary

| view | L1 | L2 | L3 |
| --- | --- | --- | --- |
| structural | 4/34 | 34/34 | 30/34 |
| gate | 34/34 | 30/34 | 24/34 |

## Per fixture

| fixture | view | L1 | L2 | L3 |
| --- | --- | --- | --- | --- |
| 7458.v | structural | FAIL | pass | pass |
| 7458.v | gate | pass | pass | pass |
| arith_compare.v | structural | FAIL | pass | pass |
| arith_compare.v | gate | pass | pass | pass |
| case_mux.v | structural | FAIL | pass | pass |
| case_mux.v | gate | pass | FAIL | pass |
| counter4.v | structural | FAIL | pass | pass |
| counter4.v | gate | pass | pass | pass |
| dff_async.v | structural | FAIL | pass | pass |
| dff_async.v | gate | pass | pass | pass |
| dff_enable.v | structural | FAIL | pass | pass |
| dff_enable.v | gate | pass | FAIL | pass |
| dff_sync_reset_en.v | structural | FAIL | pass | pass |
| dff_sync_reset_en.v | gate | pass | FAIL | pass |
| fsm_moore.v | structural | FAIL | pass | pass |
| fsm_moore.v | gate | pass | pass | pass |
| gates4.v | structural | FAIL | pass | pass |
| gates4.v | gate | pass | pass | pass |
| latch_en.v | structural | FAIL | pass | pass |
| latch_en.v | gate | pass | pass | FAIL |
| logic_ops.v | structural | FAIL | pass | pass |
| logic_ops.v | gate | pass | pass | pass |
| module_add_full.v | structural | FAIL | pass | FAIL |
| module_add_full.v | gate | pass | pass | FAIL |
| module_add.v | structural | FAIL | pass | FAIL |
| module_add.v | gate | pass | pass | FAIL |
| module_name.v | structural | pass | pass | FAIL |
| module_name.v | gate | pass | pass | FAIL |
| module_pos.v | structural | pass | pass | FAIL |
| module_pos.v | gate | pass | pass | FAIL |
| module_shift.v | structural | pass | pass | pass |
| module_shift.v | gate | pass | pass | pass |
| module_shift8.v | structural | FAIL | pass | pass |
| module_shift8.v | gate | pass | pass | pass |
| module.v | structural | pass | pass | pass |
| module.v | gate | pass | pass | pass |
| multi_module.v | structural | FAIL | pass | pass |
| multi_module.v | gate | pass | pass | pass |
| mux2_always.v | structural | FAIL | pass | pass |
| mux2_always.v | gate | pass | pass | pass |
| nand_nor.v | structural | FAIL | pass | pass |
| nand_nor.v | gate | pass | FAIL | pass |
| notgate.v | structural | FAIL | pass | pass |
| notgate.v | gate | pass | pass | pass |
| shift4.v | structural | FAIL | pass | pass |
| shift4.v | gate | pass | pass | FAIL |
| ternary.v | structural | FAIL | pass | pass |
| ternary.v | gate | pass | pass | pass |
| vector0.v | structural | FAIL | pass | pass |
| vector0.v | gate | pass | pass | pass |
| vector2.v | structural | FAIL | pass | pass |
| vector2.v | gate | pass | pass | FAIL |
| vector3.v | structural | FAIL | pass | pass |
| vector3.v | gate | pass | pass | FAIL |
| vector4.v | structural | FAIL | pass | pass |
| vector4.v | gate | pass | pass | FAIL |
| vector5.v | structural | FAIL | pass | pass |
| vector5.v | gate | pass | pass | pass |
| vectorgates.v | structural | FAIL | pass | pass |
| vectorgates.v | gate | pass | pass | FAIL |
| vectorr.v | structural | FAIL | pass | pass |
| vectorr.v | gate | pass | pass | pass |
| wire.v | structural | FAIL | pass | pass |
| wire.v | gate | pass | pass | pass |
| wire4.v | structural | FAIL | pass | pass |
| wire4.v | gate | pass | pass | pass |
| xnor_misc.v | structural | FAIL | pass | pass |
| xnor_misc.v | gate | pass | pass | pass |

## Failure reasons

- 7458.v, structural view, L1: not exportable: logic cloud "w1 = p2a & p2b" has no netlist semantics (cloud:assign:w1)
- arith_compare.v, structural view, L1: not exportable: logic cloud "sum = a + b" has no netlist semantics (cloud:assign:sum)
- case_mux.v, structural view, L1: not exportable: logic cloud "always @(*): y" has no netlist semantics (cloud:always:y)
- case_mux.v, gate view, L2: case_mux.v simplified: nodes=join(3) pmux(8) const(2) compare:eq(1) const(2) compare:eq(1) gate:not(1) count compare:eq: expected 2 to be +0 // Object.is equality
- counter4.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- dff_async.v, structural view, L1: not exportable: logic cloud "always @(posedge clk or posedge are…" has no netlist semantics (cloud:always:q)
- dff_enable.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- dff_enable.v, gate view, L2: dff_enable.v simplified: nodes=dff:dff(4) mux(4) count mux: expected 1 to be +0 // Object.is equality
- dff_sync_reset_en.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- dff_sync_reset_en.v, gate view, L2: dff_sync_reset_en.v simplified: nodes=dff:dff(4) mux(4) const(4) mux(4) count mux: expected 2 to be +0 // Object.is equality
- fsm_moore.v, structural view, L1: not exportable: logic cloud "out = (state == B)" has no netlist semantics (cloud:assign:out)
- gates4.v, structural view, L1: not exportable: logic cloud "out_and = &in" has no netlist semantics (cloud:assign:out_and)
- latch_en.v, structural view, L1: not exportable: logic cloud "always @(*): q" has no netlist semantics (cloud:always:q)
- latch_en.v, gate view, L3: noOverlap: "LATCH" (label title) overlaps "EN" (pin-label) near 140,59
- logic_ops.v, structural view, L1: not exportable: logic cloud "y_and = a && b" has no netlist semantics (cloud:assign:y_and)
- module_add_full.v, structural view, L1: not exportable: logic cloud "{cout, sum} = a + b + cin" has no netlist semantics (cloud:assign:cout,sum)
- module_add_full.v, structural view, L3: noOverlap: "hi : add16" (label title) overlaps "a" (pin-label) near 393,159 (+1)
- module_add_full.v, gate view, L3: noOverlap: "16" (bus-width) overlaps "[15:0]" (ripper-label) near 182,41 (+3)
- module_add.v, structural view, L1: not exportable: logic cloud "a[15:0]" has no netlist semantics (cloud:expr:lo.a)
- module_add.v, structural view, L3: noOverlap: "hi : add16" (label title) overlaps "cin" (pin-label) near 399,131 (+1)
- module_add.v, gate view, L3: noOverlap: "16" (bus-width) overlaps "[15:0]" (ripper-label) near 182,41 (+3)
- module_name.v, structural view, L3: noOverlap: "u1 : mod_a" (label title) overlaps "in1" (pin-label) near 109,46
- module_name.v, gate view, L3: noOverlap: "u1 : mod_a" (label title) overlaps "in1" (pin-label) near 109,46
- module_pos.v, structural view, L3: noOverlap: "u1 : mod_a" (label title) overlaps "p2" (pin-label) near 109,46
- module_pos.v, gate view, L3: noOverlap: "u1 : mod_a" (label title) overlaps "p2" (pin-label) near 109,46
- module_shift8.v, structural view, L1: not exportable: logic cloud "always @(*): q" has no netlist semantics (cloud:always:q)
- multi_module.v, structural view, L1: not exportable: logic cloud "y = ~x" has no netlist semantics (cloud:assign:y)
- mux2_always.v, structural view, L1: not exportable: logic cloud "out_assign = (sel_b1 & sel_…" has no netlist semantics (cloud:assign:out_assign)
- nand_nor.v, structural view, L1: not exportable: logic cloud "y1 = ~(a & b & c)" has no netlist semantics (cloud:assign:y1)
- nand_nor.v, gate view, L2: nand_nor.v simplified: nodes=gate:and(1) gate:nand(1) gate:or(1) gate:nor(1) gate:xnor(1) logicNodes: expected 5 to be 3 // Object.is equality
- notgate.v, structural view, L1: not exportable: logic cloud "out = ~in" has no netlist semantics (cloud:assign:out)
- shift4.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): sr" has no netlist semantics (cloud:always:sr)
- shift4.v, gate view, L3: noOverlap: "3" (bus-width) overlaps "[3:1]" (ripper-label) near 236,81 (+2)
- ternary.v, structural view, L1: not exportable: logic cloud "y = s ? b : a" has no netlist semantics (cloud:assign:y)
- vector0.v, structural view, L1: not exportable: logic cloud "outv = vec" has no netlist semantics (cloud:assign:outv)
- vector2.v, structural view, L1: not exportable: logic cloud "out = {in[7:0], in[15:8], i…" has no netlist semantics (cloud:assign:out)
- vector2.v, gate view, L3: noOverlap: "8" (bus-width) overlaps "[15:8]" (ripper-label) near 175,51 (+5)
- vector3.v, structural view, L1: not exportable: logic cloud "{w, x, y, z} = {a, b, c, d,…" has no netlist semantics (cloud:assign:w,x,y,z)
- vector3.v, gate view, L3: noOverlap: "2" (bus-width) overlaps "[1:0]" (ripper-label) near 176,75 (+4)
- vector4.v, structural view, L1: not exportable: logic cloud "out = {{24{in[7]}}, in}" has no netlist semantics (cloud:assign:out)
- vector4.v, gate view, L3: noOverlap: "[31:8] x24" (ripper-label) sits on split:net:in (split)
- vector5.v, structural view, L1: not exportable: logic cloud "out = ~{{5{a}}, {5{b}}, {5{…" has no netlist semantics (cloud:assign:out)
- vectorgates.v, structural view, L1: not exportable: logic cloud "out_or_bitwise = a | b" has no netlist semantics (cloud:assign:out_or_bitwise)
- vectorgates.v, gate view, L3: noOverlap: "3" (bus-width) overlaps "[5:3]" (ripper-label) near 200,87
- vectorr.v, structural view, L1: not exportable: logic cloud "out = {in[0], in[1], in[2],…" has no netlist semantics (cloud:assign:out)
- wire.v, structural view, L1: not exportable: logic cloud "out = in" has no netlist semantics (cloud:assign:out)
- wire4.v, structural view, L1: not exportable: logic cloud "w = a" has no netlist semantics (cloud:assign:w)
- xnor_misc.v, structural view, L1: not exportable: logic cloud "y1 = ~(a ^ b)" has no netlist semantics (cloud:assign:y1)

