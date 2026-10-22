module top_module(input [7:0] a, input [7:0] b,
                  output [8:0] sum, output [7:0] diff, output lt, output eq);
  assign sum  = a + b;
  assign diff = a - b;
  assign lt   = a < b;
  assign eq   = a == b;
endmodule
