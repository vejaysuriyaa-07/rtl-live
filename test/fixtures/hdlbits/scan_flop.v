// scan_flop.v: mux-D scan flop
module top_module(input clk, d, si, se, output reg q);
  always @(posedge clk)
    q <= se ? si : d;
endmodule
