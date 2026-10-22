// inverted_gates.v
module top_module(input a, b, output y_nand, y_nor, y_xnor);
  assign y_nand = ~(a & b);
  assign y_nor  = ~(a | b);
  assign y_xnor = ~(a ^ b);
endmodule
