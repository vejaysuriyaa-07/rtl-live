// latch_vs_flop.v
module top_module(input clk, d, output reg q_latch, output reg q_flop);
  always @(*)
    if (clk) q_latch = d;
  always @(posedge clk)
    q_flop <= d;
endmodule
