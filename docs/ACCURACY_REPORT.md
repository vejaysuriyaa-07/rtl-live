# Accuracy report

Generated 2026-10-22 by `npm test` (test/accuracy) from 34 fixtures in test/fixtures/hdlbits.

Levels:

- L1 functional: the netlist exported from the diagram (src/ir/toVerilog.ts) simulates identically to the source under Icarus Verilog on random vectors (clocked designs cycle by cycle). Bits that are x or z on either side are skipped and counted.
- L2 structural: the assertions in test/fixtures/expected/<fixture>.json hold (ports and structural counts for the structural view; node, net, pin and width assertions for the gate view).
- L3 readable: labels fit their symbols, no two labels overlap, every bus has a width label, Fit stays at or below 100 percent, no wire crosses a symbol.

## Summary

| view | L1 | L2 | L3 |
| --- | --- | --- | --- |
| structural | 4/34 | 34/34 | 0/34 |
| gate | 32/34 | 29/34 | 0/34 |

## Per fixture

| fixture | view | L1 | L2 | L3 |
| --- | --- | --- | --- | --- |
| 7458.v | structural | FAIL | pass | FAIL |
| 7458.v | gate | pass | pass | FAIL |
| arith_compare.v | structural | FAIL | pass | FAIL |
| arith_compare.v | gate | pass | pass | FAIL |
| case_mux.v | structural | FAIL | pass | FAIL |
| case_mux.v | gate | pass | FAIL | FAIL |
| counter4.v | structural | FAIL | pass | FAIL |
| counter4.v | gate | pass | pass | FAIL |
| dff_async.v | structural | FAIL | pass | FAIL |
| dff_async.v | gate | pass | pass | FAIL |
| dff_enable.v | structural | FAIL | pass | FAIL |
| dff_enable.v | gate | pass | FAIL | FAIL |
| dff_sync_reset_en.v | structural | FAIL | pass | FAIL |
| dff_sync_reset_en.v | gate | pass | FAIL | FAIL |
| fsm_moore.v | structural | FAIL | pass | FAIL |
| fsm_moore.v | gate | pass | pass | FAIL |
| gates4.v | structural | FAIL | pass | FAIL |
| gates4.v | gate | pass | pass | FAIL |
| latch_en.v | structural | FAIL | pass | FAIL |
| latch_en.v | gate | pass | pass | FAIL |
| logic_ops.v | structural | FAIL | pass | FAIL |
| logic_ops.v | gate | FAIL | FAIL | FAIL |
| module_add_full.v | structural | FAIL | pass | FAIL |
| module_add_full.v | gate | pass | pass | FAIL |
| module_add.v | structural | FAIL | pass | FAIL |
| module_add.v | gate | pass | pass | FAIL |
| module_name.v | structural | pass | pass | FAIL |
| module_name.v | gate | pass | pass | FAIL |
| module_pos.v | structural | pass | pass | FAIL |
| module_pos.v | gate | pass | pass | FAIL |
| module_shift.v | structural | pass | pass | FAIL |
| module_shift.v | gate | pass | pass | FAIL |
| module_shift8.v | structural | FAIL | pass | FAIL |
| module_shift8.v | gate | pass | pass | FAIL |
| module.v | structural | pass | pass | FAIL |
| module.v | gate | pass | pass | FAIL |
| multi_module.v | structural | FAIL | pass | FAIL |
| multi_module.v | gate | pass | pass | FAIL |
| mux2_always.v | structural | FAIL | pass | FAIL |
| mux2_always.v | gate | pass | pass | FAIL |
| nand_nor.v | structural | FAIL | pass | FAIL |
| nand_nor.v | gate | pass | FAIL | FAIL |
| notgate.v | structural | FAIL | pass | FAIL |
| notgate.v | gate | pass | pass | FAIL |
| shift4.v | structural | FAIL | pass | FAIL |
| shift4.v | gate | pass | pass | FAIL |
| ternary.v | structural | FAIL | pass | FAIL |
| ternary.v | gate | pass | pass | FAIL |
| vector0.v | structural | FAIL | pass | FAIL |
| vector0.v | gate | pass | pass | FAIL |
| vector2.v | structural | FAIL | pass | FAIL |
| vector2.v | gate | pass | pass | FAIL |
| vector3.v | structural | FAIL | pass | FAIL |
| vector3.v | gate | pass | pass | FAIL |
| vector4.v | structural | FAIL | pass | FAIL |
| vector4.v | gate | pass | pass | FAIL |
| vector5.v | structural | FAIL | pass | FAIL |
| vector5.v | gate | pass | pass | FAIL |
| vectorgates.v | structural | FAIL | pass | FAIL |
| vectorgates.v | gate | FAIL | pass | FAIL |
| vectorr.v | structural | FAIL | pass | FAIL |
| vectorr.v | gate | pass | pass | FAIL |
| wire.v | structural | FAIL | pass | FAIL |
| wire.v | gate | pass | pass | FAIL |
| wire4.v | structural | FAIL | pass | FAIL |
| wire4.v | gate | pass | pass | FAIL |
| xnor_misc.v | structural | FAIL | pass | FAIL |
| xnor_misc.v | gate | pass | pass | FAIL |

## Failure reasons

- 7458.v, structural view, L1: not exportable: logic cloud "w1 = p2a & p2b" has no netlist semantics (cloud:assign:w1)
- 7458.v, structural view, L3: fit: fit would zoom to 123% (cap is 200%)
- 7458.v, gate view, L3: fit: fit would zoom to 123% (cap is 200%)
- arith_compare.v, structural view, L1: not exportable: logic cloud "sum = a + b" has no netlist semantics (cloud:assign:sum)
- arith_compare.v, structural view, L3: fit: fit would zoom to 187% (cap is 200%)
- arith_compare.v, gate view, L3: fit: fit would zoom to 197% (cap is 200%)
- case_mux.v, structural view, L1: not exportable: logic cloud "always @(*): y" has no netlist semantics (cloud:always:y)
- case_mux.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- case_mux.v, gate view, L2: case_mux.v simplified: nodes=join(3) pmux(8) const(2) compare:eq(1) const(2) compare:eq(1) gate:not(1) count compare:eq: expected 2 to be +0 // Object.is equality
- case_mux.v, gate view, L3: fit: fit would zoom to 171% (cap is 200%)
- counter4.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- counter4.v, structural view, L3: fit: fit would zoom to 194% (cap is 200%)
- counter4.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- dff_async.v, structural view, L1: not exportable: logic cloud "always @(posedge clk or posedge are…" has no netlist semantics (cloud:always:q)
- dff_async.v, structural view, L3: fit: fit would zoom to 169% (cap is 200%)
- dff_async.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- dff_enable.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- dff_enable.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- dff_enable.v, gate view, L2: dff_enable.v simplified: nodes=dff:dff(4) mux(4) count mux: expected 1 to be +0 // Object.is equality
- dff_enable.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- dff_sync_reset_en.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): q" has no netlist semantics (cloud:always:q)
- dff_sync_reset_en.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- dff_sync_reset_en.v, gate view, L2: dff_sync_reset_en.v simplified: nodes=dff:dff(4) mux(4) const(4) mux(4) count mux: expected 2 to be +0 // Object.is equality
- dff_sync_reset_en.v, gate view, L3: fit: fit would zoom to 198% (cap is 200%)
- fsm_moore.v, structural view, L1: not exportable: logic cloud "out = (state == B)" has no netlist semantics (cloud:assign:out)
- fsm_moore.v, structural view, L3: fit: fit would zoom to 104% (cap is 200%)
- fsm_moore.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- gates4.v, structural view, L1: not exportable: logic cloud "out_and = &in" has no netlist semantics (cloud:assign:out_and)
- gates4.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- gates4.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- latch_en.v, structural view, L1: not exportable: logic cloud "always @(*): q" has no netlist semantics (cloud:always:q)
- latch_en.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- latch_en.v, gate view, L3: noOverlap: "LATCH" (label title) overlaps "EN" (pin-label) near 140,59; fit: fit would zoom to 200% (cap is 200%)
- logic_ops.v, structural view, L1: not exportable: logic cloud "y_and = a && b" has no netlist semantics (cloud:assign:y_and)
- logic_ops.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- logic_ops.v, gate view, L1: not exportable: gate and with 3/3-bit inputs and a 1-bit output is ambiguous (bitwise or logical) (gate:and:70f9aa7b39)
- logic_ops.v, gate view, L2: logic_ops.v simplified: nodes=gate:and(1) gate:not(1) gate:or(1) expected node {"kind":"gate","op":"and","info":{"logical":"1"}}: expected false to be true // Object.is equality
- logic_ops.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- module_add_full.v, structural view, L1: not exportable: logic cloud "{cout, sum} = a + b + cin" has no netlist semantics (cloud:assign:cout,sum)
- module_add_full.v, structural view, L3: noOverlap: "hi : add16" (label title) overlaps "a" (pin-label) near 393,54 (+1); fit: fit would zoom to 135% (cap is 200%)
- module_add_full.v, gate view, L3: noOverlap: "16" (bus-width) overlaps "[15:0]" (ripper-label) near 183,41 (+5); fit: fit would zoom to 136% (cap is 200%)
- module_add.v, structural view, L1: not exportable: logic cloud "a[15:0]" has no netlist semantics (cloud:expr:lo.a)
- module_add.v, structural view, L3: noOverlap: "hi : add16" (label title) overlaps "cin" (pin-label) near 399,131 (+1); fit: fit would zoom to 132% (cap is 200%)
- module_add.v, gate view, L3: noOverlap: "16" (bus-width) overlaps "[15:0]" (ripper-label) near 183,41 (+5); fit: fit would zoom to 136% (cap is 200%)
- module_name.v, structural view, L3: noOverlap: "u1 : mod_a" (label title) overlaps "in1" (pin-label) near 109,46; fit: fit would zoom to 200% (cap is 200%)
- module_name.v, gate view, L3: noOverlap: "u1 : mod_a" (label title) overlaps "in1" (pin-label) near 109,46; fit: fit would zoom to 200% (cap is 200%)
- module_pos.v, structural view, L3: noOverlap: "u1 : mod_a" (label title) overlaps "p2" (pin-label) near 109,46; fit: fit would zoom to 200% (cap is 200%)
- module_pos.v, gate view, L3: noOverlap: "u1 : mod_a" (label title) overlaps "p2" (pin-label) near 109,46; fit: fit would zoom to 200% (cap is 200%)
- module_shift.v, structural view, L3: fit: fit would zoom to 154% (cap is 200%)
- module_shift.v, gate view, L3: fit: fit would zoom to 154% (cap is 200%)
- module_shift8.v, structural view, L1: not exportable: logic cloud "always @(*): q" has no netlist semantics (cloud:always:q)
- module_shift8.v, structural view, L3: fit: fit would zoom to 106% (cap is 200%)
- module_shift8.v, gate view, L3: fit: fit would zoom to 118% (cap is 200%)
- module.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- module.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- multi_module.v, structural view, L1: not exportable: logic cloud "y = ~x" has no netlist semantics (cloud:assign:y)
- multi_module.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- multi_module.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- mux2_always.v, structural view, L1: not exportable: logic cloud "out_assign = (sel_b1 & sel_…" has no netlist semantics (cloud:assign:out_assign)
- mux2_always.v, structural view, L3: fit: fit would zoom to 169% (cap is 200%)
- mux2_always.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- nand_nor.v, structural view, L1: not exportable: logic cloud "y1 = ~(a & b & c)" has no netlist semantics (cloud:assign:y1)
- nand_nor.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- nand_nor.v, gate view, L2: nand_nor.v simplified: nodes=gate:and(1) gate:nand(1) gate:or(1) gate:nor(1) gate:xnor(1) logicNodes: expected 5 to be 3 // Object.is equality
- nand_nor.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- notgate.v, structural view, L1: not exportable: logic cloud "out = ~in" has no netlist semantics (cloud:assign:out)
- notgate.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- notgate.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- shift4.v, structural view, L1: not exportable: logic cloud "always @(posedge clk): sr" has no netlist semantics (cloud:always:sr)
- shift4.v, structural view, L3: fit: fit would zoom to 194% (cap is 200%)
- shift4.v, gate view, L3: noOverlap: "3" (bus-width) overlaps "[3:1]" (ripper-label) near 237,54 (+2); fit: fit would zoom to 200% (cap is 200%)
- ternary.v, structural view, L1: not exportable: logic cloud "y = s ? b : a" has no netlist semantics (cloud:assign:y)
- ternary.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- ternary.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- vector0.v, structural view, L1: not exportable: logic cloud "outv = vec" has no netlist semantics (cloud:assign:outv)
- vector0.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- vector0.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- vector2.v, structural view, L1: not exportable: logic cloud "out = {in[7:0], in[15:8], i…" has no netlist semantics (cloud:assign:out)
- vector2.v, structural view, L3: fit: fit would zoom to 176% (cap is 200%)
- vector2.v, gate view, L3: noOverlap: "8" (bus-width) overlaps "[15:8]" (ripper-label) near 168,51 (+5); fit: fit would zoom to 200% (cap is 200%)
- vector3.v, structural view, L1: not exportable: logic cloud "{w, x, y, z} = {a, b, c, d,…" has no netlist semantics (cloud:assign:w,x,y,z)
- vector3.v, structural view, L3: fit: fit would zoom to 180% (cap is 200%)
- vector3.v, gate view, L3: noOverlap: "2" (bus-width) overlaps "[1:0]" (ripper-label) near 180,75 (+3); fit: fit would zoom to 181% (cap is 200%)
- vector4.v, structural view, L1: not exportable: logic cloud "out = {{24{in[7]}}, in}" has no netlist semantics (cloud:assign:out)
- vector4.v, structural view, L3: fit: fit would zoom to 191% (cap is 200%)
- vector4.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- vector5.v, structural view, L1: not exportable: logic cloud "out = ~{{5{a}}, {5{b}}, {5{…" has no netlist semantics (cloud:assign:out)
- vector5.v, structural view, L3: fit: fit would zoom to 191% (cap is 200%)
- vector5.v, gate view, L3: fit: fit would zoom to 113% (cap is 200%)
- vectorgates.v, structural view, L1: not exportable: logic cloud "out_or_bitwise = a | b" has no netlist semantics (cloud:assign:out_or_bitwise)
- vectorgates.v, structural view, L3: fit: fit would zoom to 167% (cap is 200%)
- vectorgates.v, gate view, L1: not exportable: gate or with 3/3-bit inputs and a 1-bit output is ambiguous (bitwise or logical) (gate:or:f898e4de6a)
- vectorgates.v, gate view, L3: noOverlap: "3" (bus-width) overlaps "[5:3]" (ripper-label) near 201,87; fit: fit would zoom to 193% (cap is 200%)
- vectorr.v, structural view, L1: not exportable: logic cloud "out = {in[0], in[1], in[2],…" has no netlist semantics (cloud:assign:out)
- vectorr.v, structural view, L3: fit: fit would zoom to 180% (cap is 200%)
- vectorr.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- wire.v, structural view, L1: not exportable: logic cloud "out = in" has no netlist semantics (cloud:assign:out)
- wire.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- wire.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- wire4.v, structural view, L1: not exportable: logic cloud "w = a" has no netlist semantics (cloud:assign:w)
- wire4.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- wire4.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)
- xnor_misc.v, structural view, L1: not exportable: logic cloud "y1 = ~(a ^ b)" has no netlist semantics (cloud:assign:y1)
- xnor_misc.v, structural view, L3: fit: fit would zoom to 200% (cap is 200%)
- xnor_misc.v, gate view, L3: fit: fit would zoom to 200% (cap is 200%)

