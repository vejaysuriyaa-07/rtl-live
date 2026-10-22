module top_module(input clk, input in, output reg [3:0] sr);
  always @(posedge clk)
    sr <= {sr[2:0], in};
endmodule
