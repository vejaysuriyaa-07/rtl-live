// expect: module top_module with ports in, out and one assign cloud; no endmodule
module top_module(input in, output out);
  assign out = ~in;
