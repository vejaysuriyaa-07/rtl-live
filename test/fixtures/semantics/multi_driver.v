// Two continuous assignments drive y: an error, not a drawing.
module top_module(input a, input b, output y);
  assign y = a;
  assign y = b;
endmodule
