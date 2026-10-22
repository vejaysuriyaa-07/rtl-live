// en_flop.v: enable flop
module top_module(input clk, en, d, output reg q);
  always @(posedge clk)
    if (en) q <= d;
endmodule
