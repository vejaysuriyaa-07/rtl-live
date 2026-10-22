// expect: module top_module, ports a, b, out; the broken assign yields at most one cloud; never throws
module top_module(input a, input b, output out);
  assign out = a &
