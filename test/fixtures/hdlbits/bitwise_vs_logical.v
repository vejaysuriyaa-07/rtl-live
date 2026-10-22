// bitwise_vs_logical.v
module top_module(input [2:0] a, b, output [2:0] bw, output lg, output nb, output nl);
  assign bw = a | b;
  assign lg = a || b;
  assign nb = ~a[0];
  assign nl = !a;
endmodule
