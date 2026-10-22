module top_module(input [2:0] a, input [2:0] b, output y_and, output y_or, output y_not);
  assign y_and = a && b;
  assign y_or  = a || b;
  assign y_not = !a;
endmodule
