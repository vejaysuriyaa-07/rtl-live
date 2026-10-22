module top_module(input [31:0] a, input [31:0] b, output [31:0] sum);
  wire cout_lo;
  add16 lo(.a(a[15:0]),  .b(b[15:0]),  .cin(1'b0),    .sum(sum[15:0]),  .cout(cout_lo));
  add16 hi(.a(a[31:16]), .b(b[31:16]), .cin(cout_lo), .sum(sum[31:16]), .cout());
endmodule
