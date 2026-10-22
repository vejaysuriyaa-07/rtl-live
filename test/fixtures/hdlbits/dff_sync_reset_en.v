module top_module(input clk, input rst, input en, input [3:0] d, output reg [3:0] q);
  always @(posedge clk)
    if (rst)     q <= 4'd0;
    else if (en) q <= d;
endmodule
