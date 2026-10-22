module top_module(input a, input b, input c, output y1, output y2, output y3);
  assign y1 = ~(a & b & c);
  assign y2 = ~(a | b | c);
  assign y3 = ~(a ^ b);
endmodule
