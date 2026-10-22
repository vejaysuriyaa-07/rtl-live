// a depends on itself through combinational logic only.
module top_module(input en, output y);
  wire a;
  assign a = en & ~a;
  assign y = a;
endmodule
