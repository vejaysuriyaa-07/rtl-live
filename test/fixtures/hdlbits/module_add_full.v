module add16(input [15:0] a, input [15:0] b, input cin, output [15:0] sum, output cout);
  assign {cout, sum} = a + b + cin;
endmodule
module top_module(input [31:0] a, input [31:0] b, output [31:0] sum);
  wire c;
  add16 lo(.a(a[15:0]),  .b(b[15:0]),  .cin(1'b0), .sum(sum[15:0]),  .cout(c));
  add16 hi(.a(a[31:16]), .b(b[31:16]), .cin(c),    .sum(sum[31:16]), .cout());
endmodule
