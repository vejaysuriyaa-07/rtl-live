// rca4.v: ripple carry adder from full adders
module fa(input a, b, cin, output s, cout);
  assign s    = a ^ b ^ cin;
  assign cout = (a & b) | (a & cin) | (b & cin);
endmodule
module top_module(input [3:0] a, b, input cin, output [3:0] s, output cout);
  wire c1, c2, c3;
  fa f0(a[0], b[0], cin, s[0], c1);
  fa f1(a[1], b[1], c1,  s[1], c2);
  fa f2(a[2], b[2], c2,  s[2], c3);
  fa f3(a[3], b[3], c3,  s[3], cout);
endmodule
