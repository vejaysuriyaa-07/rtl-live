// expect: module top_module with ports a, b, out; instance u1 of mod_a may be partial; never throws
module top_module(input a, input b, output out);
  mod_a u1(.in1(a), .in2(
