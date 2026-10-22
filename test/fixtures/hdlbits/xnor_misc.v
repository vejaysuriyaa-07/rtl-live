module top_module(input a, input b, input [3:0] v, output y1, output y2, output y3);
  assign y1 = ~(a ^ b);
  assign y2 = a ~^ b;
  assign y3 = ~^v;
endmodule
