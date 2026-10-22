// expect: module top_module with ports clk, d, q; an always cloud assigning q; never throws
module top_module(input clk, input d, output reg q);
  always @(posedge clk) begin
    q <= d;
