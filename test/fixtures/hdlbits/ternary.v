module top_module(input s, input [7:0] a, input [7:0] b, output [7:0] y);
  assign y = s ? b : a;
endmodule
